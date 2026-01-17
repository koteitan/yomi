import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getNip07Pubkey,
  parseHexOrNpub,
  hexToNpub,
  fetchRelayList,
  fetchProfile,
  fetchFollowList,
  fetchProfiles,
  subscribeToNotes,
  publishNote,
} from './nostr';
import type { Profile, NoteEvent } from './nostr';
import { SpeechManager, processTextForSpeech } from './speech';
import { VERSION, GITHUB_URL } from './version';
import { log } from './utils';
import {
  type Config,
  loadConfig,
  saveConfig,
  languages,
} from './config';
import { detectLanguage, updateAuthorLanguage, getAuthorLanguage } from './config/langDetect';
import i18n from './i18n';
import './App.css';

type AppState = 'idle' | 'loading' | 'running' | 'paused';

interface NoteWithRead extends NoteEvent {
  read: boolean;
}

function App() {
  const { t } = useTranslation();

  const [pubkeyInput, setPubkeyInput] = useState('');
  const [nip07Loading, setNip07Loading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [appState, setAppState] = useState<AppState>('idle');
  const [notes, setNotes] = useState<NoteWithRead[]>([]);
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [postContent, setPostContent] = useState('');
  const [isPosting, setIsPosting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [config, setConfig] = useState<Config>(loadConfig);
  const [forcedLang, setForcedLang] = useState<string | null>(null);

  const recognitionRef = useRef<{ stop(): void } | null>(null);
  const configRef = useRef<Config>(config);
  const forcedLangRef = useRef<string | null>(null);

  const speechManager = useRef<SpeechManager | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const relaysRef = useRef<string[]>([]);
  const readingCountRef = useRef(0);
  const isProcessingRef = useRef(false);
  const notesRef = useRef<NoteWithRead[]>([]);
  const appStateRef = useRef<AppState>('idle');

  // Initialize speech manager
  useEffect(() => {
    speechManager.current = new SpeechManager();
    return () => {
      speechManager.current?.stop();
    };
  }, []);

  // Keep appStateRef in sync
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  // Keep configRef in sync
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Keep forcedLangRef in sync
  useEffect(() => {
    forcedLangRef.current = forcedLang;
  }, [forcedLang]);

  // Check for ?lang= query parameter and apply forced language
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const langParam = params.get('lang');
    if (langParam && langParam.length === 2) {
      setForcedLang(langParam);
      i18n.changeLanguage(langParam);
      return;
    }

    // Apply display language from config if no forced lang
    const cfg = loadConfig();
    if (cfg.displayLanguageMode === 'specific') {
      i18n.changeLanguage(cfg.displayLanguageSpecific);
    }
  }, []);

  // Load NIP-07 pubkey on mount
  useEffect(() => {
    const loadNip07 = async () => {
      // Small delay to ensure loading message is visible
      await new Promise((resolve) => setTimeout(resolve, 100));
      const pubkey = await getNip07Pubkey();
      setNip07Loading(false);
      if (pubkey) {
        setPubkeyInput(hexToNpub(pubkey));
        loadProfile(pubkey);
      }
    };
    loadNip07();
  }, []);

  const loadProfile = async (pubkey: string) => {
    const hexPubkey = parseHexOrNpub(pubkey);
    if (!hexPubkey) return;

    setProfileLoading(true);
    const relays = await fetchRelayList(hexPubkey);
    relaysRef.current = relays;
    const profileData = await fetchProfile(hexPubkey, relays);
    setProfile(profileData);
    setProfileLoading(false);
  };

  const handlePubkeyBlur = () => {
    const hexPubkey = parseHexOrNpub(pubkeyInput);
    if (hexPubkey) {
      loadProfile(pubkeyInput);
    } else {
      setProfile(null);
    }
  };

  const processNextNote = useCallback(() => {
    if (isProcessingRef.current) {
      log('[process] skipped (already processing)');
      return;
    }
    isProcessingRef.current = true;

    const currentNotes = notesRef.current;
    const unreadCount = currentNotes.filter((n) => !n.read).length;
    log('[process] unread:', unreadCount, 'total:', currentNotes.length);

    // Find last unread note (oldest, since newer notes are at front)
    const unreadIndex = currentNotes.findLastIndex((n) => !n.read);
    if (unreadIndex === -1) {
      // All notes read
      log('[process] no unread notes');
      isProcessingRef.current = false;
      setCurrentNoteId(null);
      return;
    }

    log('[process] reading index:', unreadIndex);
    const noteToRead = currentNotes[unreadIndex];

    // Mark as read synchronously in ref
    notesRef.current = currentNotes.map((n, i) =>
      i === unreadIndex ? { ...n, read: true } : n
    );
    setNotes(notesRef.current);
    setCurrentNoteId(noteToRead.id);

    const authorProfile = profiles.get(noteToRead.pubkey);
    const authorName = authorProfile?.display_name || authorProfile?.name || t('nostrAddress');

    const processedText = processTextForSpeech(
      noteToRead.content,
      profiles,
      t('url'),
      t('imageUrl'),
      t('nostrAddress')
    );

    const fullText = `${authorName}: ${processedText}`;

    // Determine reading language (forced lang overrides config)
    const cfg = configRef.current;
    let readingLang: string;
    if (forcedLangRef.current) {
      readingLang = forcedLangRef.current;
    } else {
      switch (cfg.readingLanguageMode) {
        case 'autoAuthor':
          readingLang = getAuthorLanguage(noteToRead.pubkey);
          break;
        case 'autoNote':
          readingLang = detectLanguage(noteToRead.content);
          break;
        case 'specific':
          readingLang = cfg.readingLanguageSpecific;
          break;
        case 'browser':
        default:
          readingLang = navigator.language.split('-')[0];
          break;
      }
    }

    // Determine timeout based on config
    const timeoutSeconds = cfg.readingLimitMode === 'limit' ? cfg.readingLimitSeconds : undefined;

    const noteNo = ++readingCountRef.current;
    log(`[reading]#${noteNo}(${readingLang}):${noteToRead.content.slice(0, 50)}${noteToRead.content.length > 50 ? '...' : ''}`);
    speechManager.current?.speak(fullText, readingLang, () => {
      log(`[done   ]#${noteNo}`);
      isProcessingRef.current = false;
      setCurrentNoteId(null);
      if (appStateRef.current === 'running') {
        processNextNote();
      }
    }, timeoutSeconds);
  }, [profiles, t]);

  const handleStart = async () => {
    const hexPubkey = parseHexOrNpub(pubkeyInput);
    if (!hexPubkey) return;

    // Unlock speech on iOS (must be called on user interaction)
    speechManager.current?.unlock();

    setAppState('loading');
    notesRef.current = [];
    setNotes([]);
    setCurrentNoteId(null);

    try {
      // Fetch relay list
      log('[start] fetching relay list...');
      const relays = await fetchRelayList(hexPubkey);
      log('[start] relay list:', relays.length, 'relays');
      relaysRef.current = relays;

      // Fetch follow list
      log('[start] fetching follow list...');
      const followList = await fetchFollowList(hexPubkey, relays);
      log('[start] follow list:', followList.length, 'follows');
      if (followList.length === 0) {
        setAppState('idle');
        return;
      }

      // Fetch profiles of followees (don't await, let it run in background)
      log('[start] fetching profiles (background)...');
      fetchProfiles(followList, relays, (p) => {
        setProfiles((prev) => new Map(prev).set(p.pubkey, p));
      });

      // Subscribe to kind:1 notes
      log('[start] subscribing to notes...');
      const unsubscribe = subscribeToNotes(followList, relays, (note, shouldReplace) => {
        // Skip if already exists
        if (notesRef.current.some((n) => n.id === note.id)) {
          return;
        }

        // Update author language data for auto-detection
        updateAuthorLanguage(note.pubkey, note.content);
        const detectedLang = detectLanguage(note.content);
        log(`[note] lang=${detectedLang}: ${note.content.slice(0, 30)}...`);

        let newNotes: NoteWithRead[];
        if (shouldReplace) {
          // Before EOSE: replace all unread notes with this one
          const readNotes = notesRef.current.filter((n) => n.read);
          newNotes = [{ ...note, read: false }, ...readNotes];
        } else {
          // After EOSE: prepend new notes (newer at top)
          newNotes = [{ ...note, read: false }, ...notesRef.current];
          // Keep only first 200 notes (newest)
          if (newNotes.length > 200) {
            newNotes = newNotes.slice(0, 200);
          }
        }
        notesRef.current = newNotes;
        setNotes(newNotes);
      });
      unsubscribeRef.current = unsubscribe;

      log('[start] running!');
      setAppState('running');
    } catch (error) {
      console.error('Error starting:', error);
      setAppState('idle');
    }
  };

  // Start processing when running and not currently speaking
  useEffect(() => {
    if (appState === 'running' && !isProcessingRef.current && !currentNoteId) {
      const unreadCount = notes.filter((n) => !n.read).length;
      if (unreadCount > 0) {
        const timer = setTimeout(() => {
          processNextNote();
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [appState, notes, currentNoteId, processNextNote]);

  const handlePause = () => {
    if (appState === 'running') {
      speechManager.current?.pause();
      setAppState('paused');
    }
  };

  const handleResume = () => {
    if (appState === 'paused') {
      speechManager.current?.resume();
      setAppState('running');
    }
  };

  const handleSkip = () => {
    speechManager.current?.skip();
  };

  const handleStop = () => {
    speechManager.current?.stop();
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setAppState('idle');
    notesRef.current = [];
    setNotes([]);
    setCurrentNoteId(null);
    readingCountRef.current = 0;
    isProcessingRef.current = false;
  };

  const handlePost = async () => {
    if (!postContent.trim() || isPosting) return;
    if (relaysRef.current.length === 0) return;

    setIsPosting(true);
    const success = await publishNote(postContent, relaysRef.current);
    if (success) {
      setPostContent('');
    }
    setIsPosting(false);
  };

  const handleSpeechRecognition = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('Speech recognition not supported');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language || 'ja-JP';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event) => {
      const transcript = event.results[event.resultIndex][0].transcript;
      setPostContent((prev) => prev + transcript);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.onerror = (event) => {
      // no-speech is not a real error, just means silence detected
      if (event.error === 'no-speech') {
        log('[speech recognition] no speech detected, continuing...');
        return;
      }
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  const isRunning = appState === 'running' || appState === 'paused';
  const unreadCount = notes.filter((n) => !n.read).length;
  const readCount = notes.filter((n) => n.read).length;

  const updateConfig = (updates: Partial<Config>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    saveConfig(newConfig);

    // Apply display language change immediately
    if (updates.displayLanguageMode || updates.displayLanguageSpecific) {
      if (newConfig.displayLanguageMode === 'browser') {
        i18n.changeLanguage(navigator.language.split('-')[0]);
      } else {
        i18n.changeLanguage(newConfig.displayLanguageSpecific);
      }
    }
  };

  return (
    <div className="app">
      <div className="header">
        <h1>yomi</h1>
        <div className="version">
          v{VERSION} | <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
      </div>

      <div className="controls">
        <div className="pubkey-row">
          {nip07Loading ? (
            <span className="nip07-loading">reading NIP-07 pubkey...</span>
          ) : (
            <>
              <input
                type="text"
                className="pubkey-input"
                value={pubkeyInput}
                onChange={(e) => setPubkeyInput(e.target.value)}
                onBlur={handlePubkeyBlur}
                placeholder={t('pubkeyPlaceholder')}
                disabled={isRunning}
              />
              {profileLoading ? (
                <span className="nip07-loading">loading profile...</span>
              ) : (
                <>
                  {profile?.picture && (
                    <img src={profile.picture} alt="" className="profile-icon" />
                  )}
                  <span className="profile-name">
                    {profile?.display_name || profile?.name || ''}
                  </span>
                </>
              )}
              {isRunning || appState === 'loading' ? (
                <button onClick={handleStop} className="btn btn-stop">
                  {t('stop')}
                </button>
              ) : (
                <button
                  onClick={handleStart}
                  disabled={!pubkeyInput}
                  className="btn btn-start"
                >
                  {t('start')}
                </button>
              )}
            </>
          )}
        </div>

        <div className="post-area">
          <textarea
            className="post-textarea"
            value={postContent}
            onChange={(e) => setPostContent(e.target.value)}
            placeholder={t('postPlaceholder')}
            disabled={isPosting || relaysRef.current.length === 0}
          />
          <button
            className={`btn btn-mic ${isListening ? 'btn-mic-active' : ''}`}
            onClick={handleSpeechRecognition}
            disabled={isPosting}
          >
            {isListening ? '...' : t('mic')}
          </button>
          <button
            className="btn btn-post"
            onClick={handlePost}
            disabled={!postContent.trim() || isPosting || relaysRef.current.length === 0}
          >
            {isPosting ? '...' : t('post')}
          </button>
        </div>

        {isRunning && (
          <div className="button-row">
            {appState === 'running' ? (
              <button onClick={handlePause} className="btn btn-pause">
                {t('pause')}
              </button>
            ) : (
              <button onClick={handleResume} className="btn btn-resume">
                {t('resume')}
              </button>
            )}
            <button onClick={handleSkip} className="btn btn-skip">
              {t('skip')}
            </button>
          </div>
        )}
      </div>

      {notes.length > 0 && (
        <div className="notes-list">
          {notes.map((note) => {
            const authorProfile = profiles.get(note.pubkey);
            const name = authorProfile?.name || '';
            const displayName = authorProfile?.display_name || '';
            const isCurrent = note.id === currentNoteId;
            return (
              <div
                key={note.id}
                className={`note-item ${note.read ? 'read' : 'unread'} ${isCurrent ? 'current' : ''}`}
              >
                <span className="note-author">
                  @{name} {displayName}
                </span>
                <span className="note-content">{note.content}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="status">
        <div className="queue-status">
          {appState === 'loading'
            ? t('loading')
            : `${t('statusRead', { count: readCount })}, ${t('statusQueue', { count: unreadCount })}`}
        </div>
      </div>

      <div className="config-row">
        <button className="btn-config" onClick={() => setShowConfig(true)}>
          ⚙
        </button>
      </div>

      {showConfig && (
        <div className="config-overlay" onClick={() => setShowConfig(false)}>
          <div className="config-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="config-header">
              <span>{t('config')}</span>
              <button className="btn-close" onClick={() => setShowConfig(false)}>×</button>
            </div>
            <div className="config-content">
              <div className="config-section">
                <div className="config-label">{t('configReadingLanguage')}</div>
                <label className="config-radio">
                  <input
                    type="radio"
                    name="readingLanguage"
                    checked={config.readingLanguageMode === 'browser'}
                    onChange={() => updateConfig({ readingLanguageMode: 'browser' })}
                  />
                  {t('configBrowserLanguage')}
                </label>
                <label className="config-radio">
                  <input
                    type="radio"
                    name="readingLanguage"
                    checked={config.readingLanguageMode === 'autoAuthor'}
                    onChange={() => updateConfig({ readingLanguageMode: 'autoAuthor' })}
                  />
                  {t('configAutoDetectAuthor')}
                </label>
                <label className="config-radio">
                  <input
                    type="radio"
                    name="readingLanguage"
                    checked={config.readingLanguageMode === 'autoNote'}
                    onChange={() => updateConfig({ readingLanguageMode: 'autoNote' })}
                  />
                  {t('configAutoDetectNote')}
                </label>
                <label className="config-radio">
                  <input
                    type="radio"
                    name="readingLanguage"
                    checked={config.readingLanguageMode === 'specific'}
                    onChange={() => updateConfig({ readingLanguageMode: 'specific' })}
                  />
                  {t('configSpecificLanguage')}:
                  <select
                    className="config-select"
                    value={config.readingLanguageSpecific}
                    onChange={(e) => updateConfig({ readingLanguageSpecific: e.target.value })}
                    disabled={config.readingLanguageMode !== 'specific'}
                  >
                    {languages.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="config-section">
                <div className="config-label">{t('configDisplayLanguage')}</div>
                <label className="config-radio">
                  <input
                    type="radio"
                    name="displayLanguage"
                    checked={config.displayLanguageMode === 'browser'}
                    onChange={() => updateConfig({ displayLanguageMode: 'browser' })}
                  />
                  {t('configBrowserLanguage')}
                </label>
                <label className="config-radio">
                  <input
                    type="radio"
                    name="displayLanguage"
                    checked={config.displayLanguageMode === 'specific'}
                    onChange={() => updateConfig({ displayLanguageMode: 'specific' })}
                  />
                  {t('configSpecificLanguage')}:
                  <select
                    className="config-select"
                    value={config.displayLanguageSpecific}
                    onChange={(e) => updateConfig({ displayLanguageSpecific: e.target.value })}
                    disabled={config.displayLanguageMode !== 'specific'}
                  >
                    {languages.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="config-section">
                <div className="config-label">{t('configReadingLimit')}</div>
                <label className="config-radio">
                  <input
                    type="radio"
                    name="readingLimit"
                    checked={config.readingLimitMode === 'none'}
                    onChange={() => updateConfig({ readingLimitMode: 'none' })}
                  />
                  {t('configNoLimit')}
                </label>
                <label className="config-radio">
                  <input
                    type="radio"
                    name="readingLimit"
                    checked={config.readingLimitMode === 'limit'}
                    onChange={() => updateConfig({ readingLimitMode: 'limit' })}
                  />
                  {t('configLimitTo')}
                  <input
                    type="number"
                    className="config-input-number"
                    value={config.readingLimitSeconds}
                    onChange={(e) => updateConfig({ readingLimitSeconds: parseInt(e.target.value) || 30 })}
                    disabled={config.readingLimitMode !== 'limit'}
                    min={1}
                    max={300}
                  />
                  {t('configSeconds')}
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

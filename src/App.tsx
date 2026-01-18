import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getNip07Pubkey,
  parseHexOrNpub,
  fetchRelayList,
  fetchProfile,
  fetchFollowList,
  fetchProfiles,
  subscribeToNotes,
  publishNote,
  publishReaction,
} from './nostr';
import type { Profile } from './nostr';
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
import * as bluesky from './bluesky';
import i18n from './i18n';
import './App.css';

type AppState = 'idle' | 'loading' | 'running' | 'paused';
type NoteSource = 'nostr' | 'bluesky';

interface NoteWithRead {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  read: boolean;
  source: NoteSource;
  // For Bluesky notes
  authorName?: string;
  authorAvatar?: string;
  cid?: string; // For Bluesky likes
}

function App() {
  const { t } = useTranslation();

  const [nip07Pubkey, setNip07Pubkey] = useState<string | null>(null);
  const [nip07Loading, setNip07Loading] = useState(true);
  const [nostrProfileLoading, setNostrProfileLoading] = useState(false);
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
  const [postToNostr, setPostToNostr] = useState(true);
  const [postToBluesky, setPostToBluesky] = useState(true);
  const [blueskyProfile, setBlueskyProfile] = useState<bluesky.BlueskyProfile | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [favoritedNotes, setFavoritedNotes] = useState<Set<string>>(new Set());

  const recognitionRef = useRef<{ stop(): void } | null>(null);
  const isMutedRef = useRef(false);
  const configRef = useRef<Config>(config);
  const forcedLangRef = useRef<string | null>(null);

  const speechManager = useRef<SpeechManager | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const relaysRef = useRef<string[]>([]);
  const readingCountRef = useRef(0);
  const isProcessingRef = useRef(false);
  const notesRef = useRef<NoteWithRead[]>([]);
  const appStateRef = useRef<AppState>('idle');
  const blueskyFollowsRef = useRef<bluesky.BlueskyProfile[]>([]);
  const blueskyPollingRef = useRef<number | null>(null);
  const blueskyLastFetchRef = useRef<string | undefined>(undefined);

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

  // Keep isMutedRef in sync
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

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

  // Load NIP-07 pubkey when Nostr source is enabled with NIP-07 mode
  useEffect(() => {
    if (!config.sourceNostr || config.nostrAuthMode !== 'nip07') {
      setNip07Loading(false);
      return;
    }

    // Already have NIP-07 pubkey
    if (nip07Pubkey) {
      setNip07Loading(false);
      return;
    }

    setNip07Loading(true);
    const loadNip07 = async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const pubkey = await getNip07Pubkey();
      setNip07Loading(false);
      if (pubkey) {
        setNip07Pubkey(pubkey);
      }
    };
    loadNip07();
  }, [config.sourceNostr, config.nostrAuthMode, nip07Pubkey]);

  // Get current Nostr pubkey based on auth mode
  const getNostrPubkey = useCallback((): string | null => {
    if (!config.sourceNostr) return null;
    if (config.nostrAuthMode === 'nip07') {
      return nip07Pubkey;
    } else {
      return parseHexOrNpub(config.nostrPubkey);
    }
  }, [config.sourceNostr, config.nostrAuthMode, config.nostrPubkey, nip07Pubkey]);

  // Load Nostr profile when pubkey changes
  useEffect(() => {
    const pubkey = getNostrPubkey();
    if (!pubkey) {
      setProfile(null);
      return;
    }

    const loadNostrProfile = async () => {
      setNostrProfileLoading(true);
      const relays = await fetchRelayList(pubkey);
      relaysRef.current = relays;
      const profileData = await fetchProfile(pubkey, relays);
      setProfile(profileData);
      setNostrProfileLoading(false);
    };
    loadNostrProfile();
  }, [getNostrPubkey]);

  // Load Bluesky profile when enabled and handle is set
  useEffect(() => {
    if (config.sourceBluesky && config.blueskyHandle) {
      bluesky.getProfile(config.blueskyHandle).then((p) => {
        setBlueskyProfile(p);
      });
    } else {
      setBlueskyProfile(null);
    }
  }, [config.sourceBluesky, config.blueskyHandle]);

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

    let authorName: string;
    if (noteToRead.source === 'bluesky') {
      authorName = noteToRead.authorName || t('blueskyAddress');
    } else {
      const authorProfile = profiles.get(noteToRead.pubkey);
      authorName = authorProfile?.display_name || authorProfile?.name || t('nostrAddress');
    }
    // Limit author name to 64 characters
    if (authorName.length > 64) {
      authorName = authorName.slice(0, 64);
    }

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
    const onEnd = () => {
      log(`[done   ]#${noteNo}`);
      isProcessingRef.current = false;
      setCurrentNoteId(null);
      if (appStateRef.current === 'running') {
        processNextNote();
      }
    };

    if (isMutedRef.current) {
      // Mute mode: wait 3 seconds silently
      log(`[muted ]#${noteNo}:${noteToRead.content.slice(0, 50)}${noteToRead.content.length > 50 ? '...' : ''}`);
      setTimeout(onEnd, 3000);
    } else {
      log(`[reading]#${noteNo}(${readingLang}):${noteToRead.content.slice(0, 50)}${noteToRead.content.length > 50 ? '...' : ''}`);
      speechManager.current?.speak(fullText, readingLang, onEnd, timeoutSeconds);
    }
  }, [profiles, t]);

  const addBlueskyPosts = useCallback((posts: bluesky.BlueskyPost[], isInitial: boolean = false) => {
    if (posts.length === 0) return;

    // For initial load, only keep the most recent post
    const postsToAdd = isInitial ? [posts[0]] : posts;

    for (const post of postsToAdd) {
      // Skip if already exists
      if (notesRef.current.some((n) => n.id === post.uri)) {
        continue;
      }

      const noteWithRead: NoteWithRead = {
        id: post.uri,
        pubkey: post.author.did,
        content: post.text,
        created_at: Math.floor(new Date(post.createdAt).getTime() / 1000),
        read: false,
        source: 'bluesky',
        authorName: post.author.displayName || post.author.handle,
        authorAvatar: post.author.avatar,
        cid: post.cid,
      };

      // Update author language data
      updateAuthorLanguage(post.author.did, post.text);
      const detectedLang = detectLanguage(post.text);
      log(`[bluesky] lang=${detectedLang}: ${post.text.slice(0, 30)}...`);

      // Add to notes and sort by created_at
      let newNotes = [noteWithRead, ...notesRef.current];
      newNotes.sort((a, b) => b.created_at - a.created_at);
      // Keep only first 200 notes (newest)
      if (newNotes.length > 200) {
        newNotes = newNotes.slice(0, 200);
      }
      notesRef.current = newNotes;
      setNotes(newNotes);
    }
  }, []);

  const handleStart = async () => {
    // Unlock speech on iOS (must be called on user interaction)
    speechManager.current?.unlock();

    setAppState('loading');
    notesRef.current = [];
    setNotes([]);
    setCurrentNoteId(null);

    try {
      let hasAnySource = false;

      // Nostr source
      if (config.sourceNostr) {
        const hexPubkey = getNostrPubkey();
        if (hexPubkey) {
          // Fetch relay list
          log('[start] fetching relay list...');
          const relays = await fetchRelayList(hexPubkey);
          log('[start] relay list:', relays.length, 'relays');
          relaysRef.current = relays;

          // Fetch follow list
          log('[start] fetching follow list...');
          const followList = await fetchFollowList(hexPubkey, relays);
          log('[start] follow list:', followList.length, 'follows');

          if (followList.length > 0) {
            hasAnySource = true;

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
                newNotes = [{ ...note, read: false, source: 'nostr' }, ...readNotes];
              } else {
                // After EOSE: prepend new notes (newer at top)
                newNotes = [{ ...note, read: false, source: 'nostr' }, ...notesRef.current];
                newNotes.sort((a, b) => b.created_at - a.created_at);
                // Keep only first 200 notes (newest)
                if (newNotes.length > 200) {
                  newNotes = newNotes.slice(0, 200);
                }
              }
              notesRef.current = newNotes;
              setNotes(newNotes);
            });
            unsubscribeRef.current = unsubscribe;
          }
        }
      }

      // Bluesky source
      if (config.sourceBluesky && config.blueskyHandle) {
        log('[start] fetching Bluesky follows...');
        const follows = await bluesky.getFollows(config.blueskyHandle);
        log('[start] Bluesky follows:', follows.length);
        blueskyFollowsRef.current = follows;

        if (follows.length > 0) {
          hasAnySource = true;

          // Fetch initial posts
          log('[start] fetching Bluesky posts...');
          const posts = await bluesky.getFollowsPosts(follows);
          log('[start] Bluesky posts:', posts.length);
          addBlueskyPosts(posts, true); // Initial load: only keep one post
          if (posts.length > 0) {
            blueskyLastFetchRef.current = posts[0].createdAt;
          }

          // Start polling for new posts
          blueskyPollingRef.current = window.setInterval(async () => {
            if (appStateRef.current !== 'running') return;
            const newPosts = await bluesky.getFollowsPosts(
              blueskyFollowsRef.current,
              blueskyLastFetchRef.current
            );
            if (newPosts.length > 0) {
              log('[bluesky] new posts:', newPosts.length);
              addBlueskyPosts(newPosts);
              blueskyLastFetchRef.current = newPosts[0].createdAt;
            }
          }, 30000); // Poll every 30 seconds
        }
      }

      if (!hasAnySource) {
        log('[start] no sources available');
        setAppState('idle');
        return;
      }

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

  const handleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    // If turning mute ON while speaking, skip current speech
    if (newMuted && currentNoteId) {
      speechManager.current?.skip();
    }
  };

  const handleFavorite = async (note: NoteWithRead) => {
    if (favoritedNotes.has(note.id)) return;

    if (note.source === 'nostr') {
      const success = await publishReaction(note.id, note.pubkey, relaysRef.current);
      if (success) {
        setFavoritedNotes((prev) => new Set(prev).add(note.id));
      }
    } else if (note.source === 'bluesky' && note.cid) {
      if (!bluesky.isLoggedIn() && config.blueskyAppKey) {
        await bluesky.login(config.blueskyHandle, config.blueskyAppKey);
      }
      const success = await bluesky.likePost(note.id, note.cid);
      if (success) {
        setFavoritedNotes((prev) => new Set(prev).add(note.id));
      }
    }
  };

  const handleOpenFeed = (note: NoteWithRead) => {
    if (note.source === 'nostr') {
      // Open in njump.me
      const nevent = note.id; // TODO: encode as nevent
      window.open(`https://njump.me/${nevent}`, '_blank');
    } else if (note.source === 'bluesky') {
      // Convert at:// URI to web URL
      // at://did:plc:xxx/app.bsky.feed.post/yyy -> https://bsky.app/profile/did:plc:xxx/post/yyy
      const match = note.id.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/);
      if (match) {
        const [, did, postId] = match;
        window.open(`https://bsky.app/profile/${did}/post/${postId}`, '_blank');
      }
    }
  };

  const handleStop = () => {
    speechManager.current?.stop();
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    // Stop Bluesky polling
    if (blueskyPollingRef.current) {
      clearInterval(blueskyPollingRef.current);
      blueskyPollingRef.current = null;
    }
    blueskyFollowsRef.current = [];
    blueskyLastFetchRef.current = undefined;
    setAppState('idle');
    notesRef.current = [];
    setNotes([]);
    setCurrentNoteId(null);
    readingCountRef.current = 0;
    isProcessingRef.current = false;
  };

  const handlePost = async () => {
    if (!postContent.trim() || isPosting) return;

    const canPostNostr = config.sourceNostr && postToNostr && relaysRef.current.length > 0;
    const canPostBluesky = config.sourceBluesky && postToBluesky && config.blueskyAppKey;

    if (!canPostNostr && !canPostBluesky) return;

    setIsPosting(true);

    const results: boolean[] = [];

    if (canPostNostr) {
      const nostrSuccess = await publishNote(postContent, relaysRef.current);
      results.push(nostrSuccess);
    }

    if (canPostBluesky) {
      // Login if not already
      if (!bluesky.isLoggedIn()) {
        await bluesky.login(config.blueskyHandle, config.blueskyAppKey);
      }
      const bskySuccess = await bluesky.createPost(postContent);
      results.push(bskySuccess);
    }

    if (results.some((r) => r)) {
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
        <div className="profile-row">
          {config.sourceNostr && (
            <>
              {config.nostrAuthMode === 'nip07' && nip07Loading ? (
                <span className="profile-loading">{t('loadingNip07')}</span>
              ) : nostrProfileLoading ? (
                <span className="profile-loading">{t('loadingProfile')}</span>
              ) : (
                <>
                  {profile?.picture && /^https?:\/\//i.test(profile.picture) && (
                    <img src={profile.picture} alt="" className="profile-icon" />
                  )}
                  <span className="profile-name">
                    {profile?.display_name || profile?.name || ''}
                  </span>
                </>
              )}
            </>
          )}
          {config.sourceBluesky && (
            <>
              {blueskyProfile?.avatar && /^https?:\/\//i.test(blueskyProfile.avatar) && (
                <img src={blueskyProfile.avatar} alt="" className="profile-icon" />
              )}
              <span className="profile-name">
                {blueskyProfile?.displayName || blueskyProfile?.handle || config.blueskyHandle || ''}
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
              disabled={config.sourceNostr ? !getNostrPubkey() : !config.blueskyHandle}
              className="btn btn-start"
            >
              {t('start')}
            </button>
          )}
        </div>

        <div className="post-area">
          <div className="post-row">
            <textarea
              className="post-textarea"
              value={postContent}
              onChange={(e) => setPostContent(e.target.value)}
              placeholder={t('postPlaceholder')}
              disabled={isPosting}
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
              disabled={!postContent.trim() || isPosting}
            >
              {isPosting ? '...' : t('post')}
            </button>
          </div>
          {config.sourceNostr && config.sourceBluesky && (
            <div className="post-destinations">
              <label className="post-dest-checkbox">
                <input
                  type="checkbox"
                  checked={postToNostr}
                  onChange={(e) => setPostToNostr(e.target.checked)}
                  disabled={!config.sourceNostr}
                />
                {t('sourceNostr')}
              </label>
              <label className="post-dest-checkbox">
                <input
                  type="checkbox"
                  checked={postToBluesky}
                  onChange={(e) => setPostToBluesky(e.target.checked)}
                  disabled={!config.sourceBluesky || !config.blueskyAppKey}
                />
                {t('sourceBluesky')}
              </label>
            </div>
          )}
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
            <button
              onClick={handleMute}
              className={`btn ${isMuted ? 'btn-mute-active' : 'btn-mute'}`}
            >
              {isMuted ? t('unmute') : t('mute')}
            </button>
          </div>
        )}
      </div>

      {notes.length > 0 && (
        <div className="notes-list">
          {notes.map((note) => {
            let name: string;
            let displayName: string;
            if (note.source === 'bluesky') {
              name = '';
              displayName = note.authorName || '';
            } else {
              const authorProfile = profiles.get(note.pubkey);
              name = authorProfile?.name || '';
              displayName = authorProfile?.display_name || '';
            }
            const isCurrent = note.id === currentNoteId;
            const isFavorited = favoritedNotes.has(note.id);
            return (
              <div
                key={note.id}
                className={`note-item ${note.read ? 'read' : 'unread'} ${isCurrent ? 'current' : ''}`}
              >
                <div className="note-text">
                  <span className="note-author">
                    @{name} {displayName}
                  </span>
                  <span className="note-content">{note.content}</span>
                </div>
                <span className="note-actions">
                  <button
                    className={`note-action-btn note-fav ${isFavorited ? 'favorited' : ''}`}
                    onClick={() => handleFavorite(note)}
                    disabled={isFavorited}
                    title="Favorite"
                  >
                    <svg viewBox="0 0 24 24" className="icon-heart">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                    </svg>
                  </button>
                  <button
                    className="note-action-btn note-source"
                    onClick={() => handleOpenFeed(note)}
                    title={note.source === 'nostr' ? 'Open in Nostr' : 'Open in Bluesky'}
                  >
                    {note.source === 'nostr' ? (
                      <svg viewBox="0 0 24 24" className="icon-nostr">
                        <path d="M12 3c-1.5 0-2.5 1-3 2l-1 3-4 1c0 2 1 3 2 4l-1 5c0 1 1 2 2 2l2-1 1 3h2l1-3 2 1c1 0 2-1 2-2l-1-5c1-1 2-2 2-4l-4-1-1-3c-.5-1-1.5-2-3-2z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" className="icon-bluesky">
                        <path d="M12 4C9 4 6 7 6 10c0 2 1 3 2 4-2 0-4 1-4 3 0 1 1 2 2 2 2 0 4-1 6-3 2 2 4 3 6 3 1 0 2-1 2-2 0-2-2-3-4-3 1-1 2-2 2-4 0-3-3-6-6-6z" />
                      </svg>
                    )}
                  </button>
                </span>
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
                <div className="config-label">{t('configSources')}</div>
                <label className="config-checkbox">
                  <input
                    type="checkbox"
                    checked={config.sourceNostr}
                    onChange={(e) => updateConfig({ sourceNostr: e.target.checked })}
                  />
                  {t('sourceNostr')}
                </label>
                {config.sourceNostr && (
                  <div className="config-nostr-inputs">
                    <label className="config-radio">
                      <input
                        type="radio"
                        name="nostrAuth"
                        checked={config.nostrAuthMode === 'nip07'}
                        onChange={() => updateConfig({ nostrAuthMode: 'nip07' })}
                      />
                      NIP-07
                    </label>
                    <label className="config-radio">
                      <input
                        type="radio"
                        name="nostrAuth"
                        checked={config.nostrAuthMode === 'pubkey'}
                        onChange={() => updateConfig({ nostrAuthMode: 'pubkey' })}
                      />
                      {t('configInputPubkey')}
                    </label>
                    <input
                      type="text"
                      className="config-input-text"
                      placeholder={t('pubkeyPlaceholder')}
                      value={config.nostrPubkey}
                      onChange={(e) => updateConfig({ nostrPubkey: e.target.value })}
                      disabled={config.nostrAuthMode === 'nip07'}
                    />
                  </div>
                )}
                <label className="config-checkbox">
                  <input
                    type="checkbox"
                    checked={config.sourceBluesky}
                    onChange={(e) => updateConfig({ sourceBluesky: e.target.checked })}
                  />
                  {t('sourceBluesky')}
                </label>
                {config.sourceBluesky && (
                  <div className="config-bluesky-inputs">
                    <input
                      type="text"
                      className="config-input-text"
                      placeholder={t('blueskyHandlePlaceholder')}
                      value={config.blueskyHandle}
                      onChange={(e) => updateConfig({ blueskyHandle: e.target.value })}
                    />
                    <input
                      type="password"
                      className="config-input-text"
                      placeholder={t('blueskyAppKey')}
                      value={config.blueskyAppKey}
                      onChange={(e) => updateConfig({ blueskyAppKey: e.target.value })}
                    />
                  </div>
                )}
              </div>

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

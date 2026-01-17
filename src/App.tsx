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

  const recognitionRef = useRef<{ stop(): void } | null>(null);

  const speechManager = useRef<SpeechManager | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const relaysRef = useRef<string[]>([]);
  const readingCountRef = useRef(0);
  const isProcessingRef = useRef(false);
  const notesRef = useRef<NoteWithRead[]>([]);

  // Initialize speech manager
  useEffect(() => {
    speechManager.current = new SpeechManager();
    return () => {
      speechManager.current?.stop();
    };
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
      console.log('[process] skipped (already processing)');
      return;
    }
    isProcessingRef.current = true;

    const currentNotes = notesRef.current;
    const unreadCount = currentNotes.filter((n) => !n.read).length;
    console.log('[process] unread:', unreadCount, 'total:', currentNotes.length);

    // Find last unread note (oldest, since newer notes are at front)
    const unreadIndex = currentNotes.findLastIndex((n) => !n.read);
    if (unreadIndex === -1) {
      // All notes read
      console.log('[process] no unread notes');
      isProcessingRef.current = false;
      setCurrentNoteId(null);
      return;
    }

    console.log('[process] reading index:', unreadIndex);
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
      t('nostrAddress')
    );

    const fullText = `${authorName}: ${processedText}`;

    const noteNo = ++readingCountRef.current;
    console.log(`[reading]#${noteNo}:${noteToRead.content.slice(0, 50)}${noteToRead.content.length > 50 ? '...' : ''}`);
    speechManager.current?.speak(fullText, () => {
      console.log(`[done   ]#${noteNo}`);
      isProcessingRef.current = false;
      setCurrentNoteId(null);
      processNextNote();
    });
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
      console.log('[start] fetching relay list...');
      const relays = await fetchRelayList(hexPubkey);
      console.log('[start] relay list:', relays.length, 'relays');
      relaysRef.current = relays;

      // Fetch follow list
      console.log('[start] fetching follow list...');
      const followList = await fetchFollowList(hexPubkey, relays);
      console.log('[start] follow list:', followList.length, 'follows');
      if (followList.length === 0) {
        setAppState('idle');
        return;
      }

      // Fetch profiles of followees (don't await, let it run in background)
      console.log('[start] fetching profiles (background)...');
      fetchProfiles(followList, relays, (p) => {
        setProfiles((prev) => new Map(prev).set(p.pubkey, p));
      });

      // Subscribe to kind:1 notes
      console.log('[start] subscribing to notes...');
      const unsubscribe = subscribeToNotes(followList, relays, (note) => {
        // Skip if already exists
        if (notesRef.current.some((n) => n.id === note.id)) {
          return;
        }
        // Prepend new notes (newer at top)
        let newNotes = [{ ...note, read: false }, ...notesRef.current];
        // Keep only first 200 notes (newest)
        if (newNotes.length > 200) {
          newNotes = newNotes.slice(0, 200);
        }
        notesRef.current = newNotes;
        setNotes(newNotes);
      });
      unsubscribeRef.current = unsubscribe;

      console.log('[start] running!');
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
        console.log('[speech recognition] no speech detected, continuing...');
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
              <button
                onClick={handleStart}
                disabled={!pubkeyInput || appState === 'loading' || isRunning}
                className="btn btn-start"
              >
                {appState === 'loading' ? t('loading') : t('start')}
              </button>
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
            <button onClick={handleStop} className="btn btn-stop">
              {t('stop')}
            </button>
          </div>
        )}
      </div>

      <div className="status">
        <div className="queue-status">
          {t('statusRead', { count: readCount })}, {t('statusQueue', { count: unreadCount })}
        </div>
      </div>

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
    </div>
  );
}

export default App;

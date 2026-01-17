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
} from './nostr';
import type { Profile, NoteEvent } from './nostr';
import { SpeechManager, processTextForSpeech } from './speech';
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

  const speechManager = useRef<SpeechManager | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const relaysRef = useRef<string[]>([]);
  const readingCountRef = useRef(0);
  const isProcessingRef = useRef(false);

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
        setPubkeyInput(pubkey);
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
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    setNotes((currentNotes) => {
      // Find last unread note (oldest, since newer notes are at front)
      const unreadIndex = currentNotes.findLastIndex((n) => !n.read);
      if (unreadIndex === -1) {
        // All notes read, wait a bit then say EOSE if still empty
        isProcessingRef.current = false;
        setCurrentNoteId(null);
        return currentNotes;
      }

      const note = currentNotes[unreadIndex];
      setCurrentNoteId(note.id);

      const authorProfile = profiles.get(note.pubkey);
      const authorName = authorProfile?.display_name || authorProfile?.name || t('nostrAddress');

      const processedText = processTextForSpeech(
        note.content,
        profiles,
        t('url'),
        t('nostrAddress')
      );

      const fullText = `${authorName}: ${processedText}`;

      const noteNo = ++readingCountRef.current;
      console.log(`[reading]#${noteNo}:${note.content.slice(0, 50)}${note.content.length > 50 ? '...' : ''}`);
      speechManager.current?.speak(fullText, () => {
        console.log(`[done   ]#${noteNo}`);
        isProcessingRef.current = false;
        processNextNote();
      });

      // Mark as read
      const newNotes = [...currentNotes];
      newNotes[unreadIndex] = { ...note, read: true };
      return newNotes;
    });
  }, [profiles, t]);

  const handleStart = async () => {
    const hexPubkey = parseHexOrNpub(pubkeyInput);
    if (!hexPubkey) return;

    setAppState('loading');
    setNotes([]);
    setCurrentNoteId(null);

    try {
      // Fetch relay list
      const relays = await fetchRelayList(hexPubkey);
      relaysRef.current = relays;

      // Fetch follow list
      const followList = await fetchFollowList(hexPubkey, relays);
      if (followList.length === 0) {
        setAppState('idle');
        return;
      }

      // Fetch profiles of followees
      await fetchProfiles(followList, relays, (p) => {
        setProfiles((prev) => new Map(prev).set(p.pubkey, p));
      });

      // Subscribe to kind:1 notes
      const unsubscribe = subscribeToNotes(followList, relays, (note) => {
        setNotes((prev) => {
          // Skip if already exists
          if (prev.some((n) => n.id === note.id)) {
            return prev;
          }
          // Prepend new notes (newer at top)
          const newNotes = [{ ...note, read: false }, ...prev];
          // Keep only first 200 notes (newest)
          if (newNotes.length > 200) {
            return newNotes.slice(0, 200);
          }
          return newNotes;
        });
      });
      unsubscribeRef.current = unsubscribe;

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
    setNotes([]);
    setCurrentNoteId(null);
    readingCountRef.current = 0;
    isProcessingRef.current = false;
  };

  const isRunning = appState === 'running' || appState === 'paused';
  const unreadCount = notes.filter((n) => !n.read).length;
  const readCount = notes.filter((n) => n.read).length;

  return (
    <div className="app">
      <div className="header">
        <h1>yomi</h1>
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
            </>
          )}
        </div>

        <div className="button-row">
          {!isRunning ? (
            <button
              onClick={handleStart}
              disabled={!pubkeyInput || appState === 'loading'}
              className="btn btn-start"
            >
              {appState === 'loading' ? t('loading') : t('start')}
            </button>
          ) : (
            <>
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
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      <div className="status">
        <div className="queue-status">
          read: {readCount} events, in queue: {unreadCount} events
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

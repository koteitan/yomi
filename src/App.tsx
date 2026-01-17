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

function App() {
  const { t } = useTranslation();

  const [pubkeyInput, setPubkeyInput] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [appState, setAppState] = useState<AppState>('idle');
  const [queue, setQueue] = useState<NoteEvent[]>([]);
  const [currentNote, setCurrentNote] = useState<NoteEvent | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());

  const speechManager = useRef<SpeechManager | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const relaysRef = useRef<string[]>([]);

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
      const pubkey = await getNip07Pubkey();
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

    const relays = await fetchRelayList(hexPubkey);
    relaysRef.current = relays;
    const profileData = await fetchProfile(hexPubkey, relays);
    setProfile(profileData);
  };

  const handlePubkeyBlur = () => {
    const hexPubkey = parseHexOrNpub(pubkeyInput);
    if (hexPubkey) {
      loadProfile(pubkeyInput);
    } else {
      setProfile(null);
    }
  };

  const processQueue = useCallback(() => {
    setQueue((currentQueue) => {
      if (currentQueue.length === 0) {
        // Say EOSE
        speechManager.current?.speak(t('eose'), () => {
          setCurrentNote(null);
        });
        return currentQueue;
      }

      const [nextNote, ...rest] = currentQueue;
      setCurrentNote(nextNote);

      const authorProfile = profiles.get(nextNote.pubkey);
      const authorName = authorProfile?.display_name || authorProfile?.name || t('nostrAddress');

      const processedText = processTextForSpeech(
        nextNote.content,
        profiles,
        t('url'),
        t('nostrAddress')
      );

      const fullText = `${authorName}: ${processedText}`;

      speechManager.current?.speak(fullText, () => {
        processQueue();
      });

      return rest;
    });
  }, [profiles, t]);

  const handleStart = async () => {
    const hexPubkey = parseHexOrNpub(pubkeyInput);
    if (!hexPubkey) return;

    setAppState('loading');
    setQueue([]);
    setCurrentNote(null);

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
      const newProfiles = new Map<string, Profile>();
      await fetchProfiles(followList, relays, (p) => {
        newProfiles.set(p.pubkey, p);
        setProfiles((prev) => new Map(prev).set(p.pubkey, p));
      });

      // Subscribe to kind:1 notes
      const unsubscribe = subscribeToNotes(followList, relays, (note) => {
        setQueue((prev) => [...prev, note]);
      });
      unsubscribeRef.current = unsubscribe;

      setAppState('running');
    } catch (error) {
      console.error('Error starting:', error);
      setAppState('idle');
    }
  };

  // Start processing queue when running and not currently speaking
  useEffect(() => {
    if (appState === 'running' && !speechManager.current?.speaking && !currentNote) {
      const timer = setTimeout(() => {
        if (queue.length > 0) {
          processQueue();
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [appState, queue, currentNote, processQueue]);

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
    setQueue([]);
    setCurrentNote(null);
  };

  const isRunning = appState === 'running' || appState === 'paused';

  return (
    <div className="app">
      <div className="header">
        <h1>yomi</h1>
      </div>

      <div className="controls">
        <div className="pubkey-row">
          <input
            type="text"
            className="pubkey-input"
            value={pubkeyInput}
            onChange={(e) => setPubkeyInput(e.target.value)}
            onBlur={handlePubkeyBlur}
            placeholder={t('pubkeyPlaceholder')}
            disabled={isRunning}
          />
          {profile?.picture && (
            <img src={profile.picture} alt="" className="profile-icon" />
          )}
          <span className="profile-name">
            {profile?.display_name || profile?.name || ''}
          </span>
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
          {t('queueStatus', { count: queue.length })}
        </div>
        {currentNote && (
          <div className="current-note">
            <div className="current-label">{t('currentlyReading')}</div>
            <div className="current-content">
              {(() => {
                const authorProfile = profiles.get(currentNote.pubkey);
                const authorName = authorProfile?.display_name || authorProfile?.name || '';
                return (
                  <>
                    <strong>{authorName}</strong>: {currentNote.content.slice(0, 200)}
                    {currentNote.content.length > 200 ? '...' : ''}
                  </>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;

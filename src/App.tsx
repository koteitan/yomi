import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getNip07Pubkey,
  parseHexOrNpub,
  hexToNevent,
  fetchRelayList,
  fetchProfile,
  fetchFollowList,
  fetchProfiles,
  subscribeToNotes,
  publishNote,
  publishReaction,
} from './nostr';
import type { Profile } from './nostr';
import { SpeechManager, processTextForSpeech, type ReadingTargetOptions } from './speech';
import { VERSION, GITHUB_URL } from './version';
import { log, startmon, logNostr, logBluesky, logMisskey, logDiscord, logNostrEvent, logBlueskyEvent, logMisskeyEvent, logDiscordEvent, logReading } from './utils';
import {
  type Config,
  loadConfig,
  saveConfig,
  languages,
} from './config';
import { detectLanguage, updateAuthorLanguage, getAuthorLanguage } from './config/langDetect';
import * as bluesky from './bluesky';
import * as misskey from './misskey';
import * as discord from './discord';
import i18n from './i18n';
import './App.css';

type AppState = 'idle' | 'loading' | 'running' | 'paused';
type NoteSource = 'nostr' | 'bluesky' | 'misskey' | 'discord' | 'test';

// Pattern for linkifying text (URLs and nostr: addresses)
const LINK_PATTERN = /(https?:\/\/[^\s]+|nostr:n(?:pub|sec|profile|event|ote|addr|relay)1[a-z0-9]+)/gi;

// Convert URLs and nostr: addresses to clickable links
function linkifyText(text: string): React.ReactNode[] {
  const parts = text.split(LINK_PATTERN);
  return parts.map((part, index) => {
    if (!part) return null;

    // Check for nostr: address
    if (/^nostr:n/i.test(part)) {
      const naddr = part.replace(/^nostr:/i, '');
      return (
        <a key={index} href={`https://nostter.app/${naddr}`} target="_blank" rel="noopener noreferrer">
          {part}
        </a>
      );
    }

    // Check for URL
    if (/^https?:\/\//i.test(part)) {
      return (
        <a key={index} href={part} target="_blank" rel="noopener noreferrer">
          {part}
        </a>
      );
    }

    return part;
  });
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

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
  const [postToMisskey, setPostToMisskey] = useState(true);
  const [blueskyProfile, setBlueskyProfile] = useState<bluesky.BlueskyProfile | null>(null);
  const [misskeyProfile, setMisskeyProfile] = useState<misskey.MisskeyProfile | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [favoritedNotes, setFavoritedNotes] = useState<Set<string>>(new Set());
  const [wsDebugStatus, setWsDebugStatus] = useState(window.wsDebugStatus);

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
  const blueskyPollingRef = useRef<number | null>(null);
  const blueskyLastFetchRef = useRef<string | undefined>(undefined);
  const profilesRef = useRef<Map<string, Profile>>(new Map());
  // Track content that the user has already read (to skip duplicate multi-posts)
  // Map key: content string, value: timestamp when read
  const myReadContentRef = useRef<Map<string, number>>(new Map());

  // Initialize speech manager
  useEffect(() => {
    speechManager.current = new SpeechManager();
    speechManager.current.volume = loadConfig().volume;
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

  // Keep profilesRef in sync
  useEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);

  // Listen for wsDebug status changes
  useEffect(() => {
    const handleStatusChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      setWsDebugStatus({ ...customEvent.detail });
    };
    window.addEventListener('wsDebugStatusChange', handleStatusChange);
    return () => window.removeEventListener('wsDebugStatusChange', handleStatusChange);
  }, []);

  // Apply theme
  useEffect(() => {
    const applyTheme = (theme: 'light' | 'dark') => {
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    if (config.theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mediaQuery.matches ? 'dark' : 'light');

      const handler = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? 'dark' : 'light');
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    } else {
      applyTheme(config.theme);
    }
  }, [config.theme]);

  // Check for query parameters on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    // ?startmon - enable event logging
    if (params.has('startmon')) {
      startmon(true);
    }

    // ?lang= - force language
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

  // Load Misskey profile when enabled and token is set
  useEffect(() => {
    if (config.sourceMisskey && config.misskeyAccessToken) {
      misskey.login(config.misskeyAccessToken).then((success) => {
        if (success) {
          misskey.getMyProfile().then((p) => {
            setMisskeyProfile(p);
          });
        } else {
          setMisskeyProfile(null);
        }
      });
    } else {
      setMisskeyProfile(null);
    }
  }, [config.sourceMisskey, config.misskeyAccessToken]);

  // Logout from Bluesky when handle or app key changes
  const blueskyCredentialsRef = useRef({ handle: config.blueskyHandle, appKey: config.blueskyAppKey });
  useEffect(() => {
    const prev = blueskyCredentialsRef.current;
    if (prev.handle !== config.blueskyHandle || prev.appKey !== config.blueskyAppKey) {
      bluesky.logout();
      logBluesky('logged out due to credentials change');
    }
    blueskyCredentialsRef.current = { handle: config.blueskyHandle, appKey: config.blueskyAppKey };
  }, [config.blueskyHandle, config.blueskyAppKey]);

  // Logout from Misskey when token changes
  const misskeyTokenRef = useRef(config.misskeyAccessToken);
  useEffect(() => {
    if (misskeyTokenRef.current !== config.misskeyAccessToken) {
      misskey.logout();
      logMisskey('logged out due to token change');
    }
    misskeyTokenRef.current = config.misskeyAccessToken;
  }, [config.misskeyAccessToken]);

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

    // Check for duplicate multi-post from the user
    // Skip if: author is current user AND same content was already read
    const content = noteToRead.content;
    let isMyPost = false;
    const myNostrPubkey = getNostrPubkey();

    if (noteToRead.source === 'nostr' && myNostrPubkey) {
      isMyPost = noteToRead.pubkey === myNostrPubkey;
    } else if (noteToRead.source === 'bluesky' && blueskyProfile) {
      isMyPost = noteToRead.pubkey === blueskyProfile.did;
    } else if (noteToRead.source === 'misskey' && misskeyProfile) {
      isMyPost = noteToRead.pubkey === misskeyProfile.id;
    }

    if (isMyPost) {
      const myReadContent = myReadContentRef.current;
      const readTimestamp = myReadContent.get(content);

      if (readTimestamp) {
        // Already read this content from user's own post, skip
        log('[process] skipping duplicate multi-post (already read)');
        isProcessingRef.current = false;
        setCurrentNoteId(null);
        if (appStateRef.current === 'running') {
          processNextNote();
        }
        return;
      } else {
        // First read of this content, mark as read with timestamp
        log('[process] first read of user multi-post');
        myReadContent.set(content, Date.now());
        // Clean up after 60 seconds
        setTimeout(() => {
          myReadContent.delete(content);
        }, 60000);
      }
    }

    let authorName: string;
    if (noteToRead.source === 'bluesky') {
      authorName = noteToRead.authorName || t('blueskyAddress');
    } else if (noteToRead.source === 'misskey') {
      authorName = noteToRead.authorName || t('misskeyAddress');
    } else if (noteToRead.source === 'test') {
      authorName = noteToRead.authorName || 'Test';
    } else {
      const authorProfile = profiles.get(noteToRead.pubkey);
      authorName = authorProfile?.display_name || authorProfile?.name || t('nostrAddress');
    }
    // Remove emojis, custom emojis, slashes and bracketed content from author name
    authorName = authorName
      .replace(/:[a-zA-Z0-9_]+:/g, '') // Custom emojis like :smile:
      .replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1FA00}-\u{1FAFF}]|[\u{FE00}-\u{FE0F}]|[\u{200D}]/gu, '') // Unicode emojis
      .replace(/[/／].*$/, '') // Remove everything after / or ／
      .replace(/（[^）]*）/g, '') // Remove content in （）
      .replace(/\([^)]*\)/g, '') // Remove content in ()
      .replace(/\[[^\]]*\]/g, '') // Remove content in []
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim();
    // Limit author name to 64 characters
    if (authorName.length > 64) {
      authorName = authorName.slice(0, 64);
    }

    const readingOptions: ReadingTargetOptions = {
      readEmoji: configRef.current.readEmoji,
      readCustomEmoji: configRef.current.readCustomEmoji,
      readUrl: configRef.current.readUrl,
    };
    const processedText = processTextForSpeech(
      noteToRead.content,
      profiles,
      t('url'),
      t('imageUrl'),
      t('nostrAddress'),
      readingOptions
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
      log(`[muted] #${noteNo} ${authorName}: ${noteToRead.content.slice(0, 50)}...`);
      setTimeout(onEnd, 3000);
    } else {
      logReading(noteNo, readingLang, authorName, noteToRead.content);
      speechManager.current?.speak(fullText, readingLang, onEnd, timeoutSeconds);
    }
  }, [profiles, t, getNostrPubkey, blueskyProfile, misskeyProfile]);

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
      logBlueskyEvent(post.createdAt, post.author.displayName || post.author.handle, post.text);

      // Add to notes and sort by created_at
      let newNotes = [noteWithRead, ...notesRef.current];
      newNotes.sort((a, b) => b.created_at - a.created_at);
      // Keep only first 200 notes (newest)
      if (newNotes.length > 200) {
        newNotes = newNotes.slice(0, 200);
      }
      notesRef.current = newNotes;
      setNotes(newNotes);

      // Start running immediately when first post arrives (don't wait for all sources)
      if (appStateRef.current === 'loading') {
        log('[app] running!');
        appStateRef.current = 'running'; // Update ref immediately (state is async)
        setAppState('running');
      }
    }
  }, []);

  const addMisskeyNotes = useCallback((notes: misskey.MisskeyNote[], isInitial: boolean = false) => {
    if (notes.length === 0) return;

    // For initial load, only keep the most recent note
    const notesToAdd = isInitial ? [notes[0]] : notes;

    for (const note of notesToAdd) {
      // Skip if already exists or no text
      if (!note.text || notesRef.current.some((n) => n.id === note.id)) {
        continue;
      }

      const noteWithRead: NoteWithRead = {
        id: note.id,
        pubkey: note.user.id,
        content: note.text,
        created_at: Math.floor(new Date(note.createdAt).getTime() / 1000),
        read: false,
        source: 'misskey',
        authorName: note.user.name || note.user.username,
        authorAvatar: note.user.avatarUrl || undefined,
      };

      // Update author language data
      updateAuthorLanguage(note.user.id, note.text);
      logMisskeyEvent(note.createdAt, note.user.name || note.user.username, note.text);

      // Add to notes and sort by created_at
      let newNotes = [noteWithRead, ...notesRef.current];
      newNotes.sort((a, b) => b.created_at - a.created_at);
      // Keep only first 200 notes (newest)
      if (newNotes.length > 200) {
        newNotes = newNotes.slice(0, 200);
      }
      notesRef.current = newNotes;
      setNotes(newNotes);

      // Start running immediately when first note arrives (don't wait for all sources)
      if (appStateRef.current === 'loading') {
        log('[app] running!');
        appStateRef.current = 'running'; // Update ref immediately (state is async)
        setAppState('running');
      }
    }
  }, []);

  const addDiscordMessages = useCallback((messages: discord.DiscordMessage[], isInitial: boolean = false) => {
    if (messages.length === 0) return;

    // For initial load, only keep the most recent message
    const messagesToAdd = isInitial ? [messages[0]] : messages;

    for (const message of messagesToAdd) {
      // Skip if already exists or no content
      if (!message.content || notesRef.current.some((n) => n.id === message.id)) {
        continue;
      }

      const noteWithRead: NoteWithRead = {
        id: message.id,
        pubkey: message.author.id,
        content: message.content,
        created_at: Math.floor(new Date(message.timestamp).getTime() / 1000),
        read: false,
        source: 'discord',
        authorName: message.author.displayName,
        authorAvatar: message.author.avatarUrl || undefined,
      };

      // Update author language data
      updateAuthorLanguage(message.author.id, message.content);
      logDiscordEvent(message.timestamp, message.author.displayName, message.content);

      // Add to notes and sort by created_at
      let newNotes = [noteWithRead, ...notesRef.current];
      newNotes.sort((a, b) => b.created_at - a.created_at);
      // Keep only first 200 notes (newest)
      if (newNotes.length > 200) {
        newNotes = newNotes.slice(0, 200);
      }
      notesRef.current = newNotes;
      setNotes(newNotes);

      // Start running immediately when first note arrives (don't wait for all sources)
      if (appStateRef.current === 'loading') {
        log('[app] running!');
        appStateRef.current = 'running'; // Update ref immediately (state is async)
        setAppState('running');
      }
    }
  }, []);

  // Test post function for debugging - exposed to window.testpost()
  const testpost = useCallback((content: string, authorName: string = 'Test') => {
    const note: NoteWithRead = {
      id: `test-${Date.now()}`,
      pubkey: 'test-pubkey',
      content,
      created_at: Math.floor(Date.now() / 1000),
      read: false,
      source: 'test',
      authorName,
    };

    log(`[test] adding test post: ${authorName}: ${content.slice(0, 50)}...`);

    let newNotes = [note, ...notesRef.current];
    newNotes.sort((a, b) => b.created_at - a.created_at);
    if (newNotes.length > 200) {
      newNotes = newNotes.slice(0, 200);
    }
    notesRef.current = newNotes;
    setNotes(newNotes);

    // Start processing if running
    if (appStateRef.current === 'running' && !isProcessingRef.current) {
      processNextNote();
    }
  }, [processNextNote]);

  // Expose debug functions to window for console debugging
  useEffect(() => {
    const win = window as unknown as {
      testpost?: typeof testpost;
      help?: () => void;
    };
    win.testpost = testpost;
    win.help = () => {
      console.log(`
=== yomi debug functions ===
testpost(content, authorName?)  - Add a test post to the queue
  content: string     - Text content to read (required)
  authorName: string  - Author name (default: "Test")
  Example: testpost("Hello world!")
  Example: testpost("Test message", "Alice")

help()  - Show this help message
================================
      `.trim());
    };
    return () => {
      delete win.testpost;
      delete win.help;
    };
  }, [testpost]);

  const handleStart = async () => {
    // Unlock speech on iOS (must be called on user interaction)
    speechManager.current?.unlock();

    setAppState('loading');
    notesRef.current = [];
    setNotes([]);
    setCurrentNoteId(null);

    // Helper to set running state (called when first note arrives from any source)
    const setRunningIfLoading = () => {
      if (appStateRef.current === 'loading') {
        log('[app] running!');
        appStateRef.current = 'running';
        setAppState('running');
      }
    };

    // Nostr source initialization
    const initNostr = async (): Promise<boolean> => {
      if (!config.sourceNostr) return false;

      const hexPubkey = getNostrPubkey();
      if (!hexPubkey) return false;

      logNostr('fetching relay list...');
      const relays = await fetchRelayList(hexPubkey);
      logNostr('relay list:', relays.length, 'relays');
      relaysRef.current = relays;

      logNostr('fetching follow list...');
      const followList = await fetchFollowList(hexPubkey, relays);
      logNostr('follow list:', followList.length, 'follows');

      if (followList.length === 0) return false;

      // Fetch profiles in background
      logNostr('fetching profiles (background)...');
      fetchProfiles(followList, relays, (p) => {
        setProfiles((prev) => new Map(prev).set(p.pubkey, p));
      });

      // Subscribe to notes
      logNostr('subscribing to notes...');
      const unsubscribe = subscribeToNotes(followList, relays, (note, shouldReplace) => {
        if (notesRef.current.some((n) => n.id === note.id)) return;

        updateAuthorLanguage(note.pubkey, note.content);
        const profile = profilesRef.current.get(note.pubkey);
        const authorName = profile?.display_name || profile?.name || note.pubkey.slice(0, 8);
        logNostrEvent(note.created_at, authorName, note.content);

        let newNotes: NoteWithRead[];
        if (shouldReplace) {
          const keepNotes = notesRef.current.filter((n) => n.read || n.source !== 'nostr');
          newNotes = [{ ...note, read: false, source: 'nostr' }, ...keepNotes];
        } else {
          newNotes = [{ ...note, read: false, source: 'nostr' }, ...notesRef.current];
          newNotes.sort((a, b) => b.created_at - a.created_at);
          if (newNotes.length > 200) newNotes = newNotes.slice(0, 200);
        }
        notesRef.current = newNotes;
        setNotes(newNotes);
        setRunningIfLoading();
      });
      unsubscribeRef.current = unsubscribe;
      return true;
    };

    // Bluesky source initialization
    const initBluesky = async (): Promise<boolean> => {
      if (!config.sourceBluesky || !config.blueskyHandle || !config.blueskyAppKey) return false;

      if (!bluesky.isLoggedIn()) {
        logBluesky('logging in...');
        await bluesky.login(config.blueskyHandle, config.blueskyAppKey);
      }

      if (!bluesky.isLoggedIn()) {
        logBluesky('login failed, skipping Bluesky');
        return false;
      }

      logBluesky('fetching timeline...');
      const posts = await bluesky.getTimeline();
      logBluesky('posts:', posts.length);
      addBlueskyPosts(posts, true);
      if (posts.length > 0) {
        blueskyLastFetchRef.current = posts[0].createdAt;
      }

      // Start polling
      blueskyPollingRef.current = window.setInterval(async () => {
        if (appStateRef.current !== 'running') return;
        const hasNew = await bluesky.peekLatest(blueskyLastFetchRef.current);
        if (!hasNew) return;
        logBluesky('new post detected, fetching...');
        const newPosts = await bluesky.getTimeline(blueskyLastFetchRef.current);
        if (newPosts.length > 0) {
          logBluesky('new posts:', newPosts.length);
          addBlueskyPosts(newPosts);
          blueskyLastFetchRef.current = newPosts[0].createdAt;
        }
      }, 5000);

      return true;
    };

    // Misskey source initialization
    const initMisskey = async (): Promise<boolean> => {
      if (!config.sourceMisskey || !config.misskeyAccessToken) return false;

      if (!misskey.isLoggedIn()) {
        logMisskey('logging in...');
        await misskey.login(config.misskeyAccessToken);
      }

      if (!misskey.isLoggedIn()) {
        logMisskey('login failed, skipping Misskey');
        return false;
      }

      logMisskey('fetching initial note...');
      const notes = await misskey.getTimeline();
      logMisskey('notes:', notes.length);
      addMisskeyNotes(notes, true);

      logMisskey('connecting to stream...');
      misskey.connectStream((note) => {
        if (appStateRef.current !== 'running') return;
        logMisskey('stream note:', note.user.name || note.user.username);
        addMisskeyNotes([note], false);
      });

      return true;
    };

    // Discord source initialization
    const initDiscord = async (): Promise<boolean> => {
      if (!config.sourceDiscord || !config.discordBotUrl) return false;

      logDiscord('connecting to bot at', config.discordBotUrl);
      discord.connectStream(config.discordBotUrl, (message) => {
        if (appStateRef.current !== 'running') return;
        logDiscord('stream message:', message.author.displayName);
        addDiscordMessages([message], false);
      });

      return true;
    };

    try {
      // Run all sources in parallel
      const results = await Promise.allSettled([initNostr(), initBluesky(), initMisskey(), initDiscord()]);

      const hasAnySource = results.some(
        (r) => r.status === 'fulfilled' && r.value === true
      );

      if (!hasAnySource) {
        log('[app] no sources available');
        setAppState('idle');
        return;
      }

      // Set running if not already set by callbacks
      if (appStateRef.current !== 'running') {
        log('[app] running!');
        appStateRef.current = 'running';
        setAppState('running');
      }
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
    } else if (note.source === 'misskey') {
      if (!misskey.isLoggedIn() && config.misskeyAccessToken) {
        await misskey.login(config.misskeyAccessToken);
      }
      const success = await misskey.createReaction(note.id);
      if (success) {
        setFavoritedNotes((prev) => new Set(prev).add(note.id));
      }
    }
  };

  const handleOpenFeed = (note: NoteWithRead) => {
    if (note.source === 'nostr') {
      // Open in nostter.app with bech32 nevent
      const nevent = hexToNevent(note.id);
      window.open(`https://nostter.app/${nevent}`, '_blank');
    } else if (note.source === 'bluesky') {
      // Convert at:// URI to web URL
      // at://did:plc:xxx/app.bsky.feed.post/yyy -> https://bsky.app/profile/did:plc:xxx/post/yyy
      const match = note.id.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/(.+)$/);
      if (match) {
        const [, did, postId] = match;
        window.open(`https://bsky.app/profile/${did}/post/${postId}`, '_blank');
      }
    } else if (note.source === 'misskey') {
      // Open in Misskey.io
      window.open(`https://misskey.io/notes/${note.id}`, '_blank');
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
    blueskyLastFetchRef.current = undefined;
    // Stop Misskey streaming
    misskey.disconnectStream();
    // Stop Discord streaming
    discord.disconnectStream();
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
    const canPostMisskey = config.sourceMisskey && postToMisskey && config.misskeyAccessToken;

    if (!canPostNostr && !canPostBluesky && !canPostMisskey) return;

    setIsPosting(true);

    const results: boolean[] = [];

    if (canPostNostr) {
      logNostr('posting:', postContent.slice(0, 50));
      const nostrSuccess = await publishNote(postContent, relaysRef.current);
      logNostr('post result:', nostrSuccess ? 'success' : 'failed');
      results.push(nostrSuccess);
    }

    if (canPostBluesky) {
      logBluesky('posting:', postContent.slice(0, 50));
      // Login if not already
      if (!bluesky.isLoggedIn()) {
        await bluesky.login(config.blueskyHandle, config.blueskyAppKey);
      }
      const bskySuccess = await bluesky.createPost(postContent);
      logBluesky('post result:', bskySuccess ? 'success' : 'failed');
      results.push(bskySuccess);
    }

    if (canPostMisskey) {
      logMisskey('posting:', postContent.slice(0, 50));
      // Login if not already
      if (!misskey.isLoggedIn()) {
        await misskey.login(config.misskeyAccessToken);
      }
      const misskeySuccess = await misskey.createNote(postContent);
      logMisskey('post result:', misskeySuccess ? 'success' : 'failed');
      results.push(misskeySuccess);
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
          {config.sourceMisskey && (
            <>
              {misskeyProfile?.avatarUrl && /^https?:\/\//i.test(misskeyProfile.avatarUrl) && (
                <img
                  src={misskeyProfile.avatarUrl}
                  alt=""
                  className="profile-icon"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              )}
              <span className="profile-name">
                {misskeyProfile?.name || misskeyProfile?.username || ''}
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
              disabled={
                (config.sourceNostr && !getNostrPubkey()) &&
                (config.sourceBluesky && !config.blueskyHandle) &&
                (config.sourceMisskey && !config.misskeyAccessToken) &&
                (config.sourceDiscord && !config.discordBotUrl)
              }
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
              className="btn btn-post"
              onClick={handlePost}
              disabled={!postContent.trim() || isPosting}
            >
              {isPosting ? '...' : t('post')}
            </button>
            <button
              className={`btn btn-mic ${isListening ? 'btn-mic-active' : ''}`}
              onClick={handleSpeechRecognition}
              disabled={isPosting}
            >
              {isListening ? t('micRecording') : t('mic')}
            </button>
          </div>
          {(Number(config.sourceNostr) + Number(config.sourceBluesky) + Number(config.sourceMisskey)) >= 2 && (
            <div className="post-destinations">
              {config.sourceNostr && (
                <label className="post-dest-checkbox">
                  <input
                    type="checkbox"
                    checked={postToNostr}
                    onChange={(e) => setPostToNostr(e.target.checked)}
                    disabled={!config.sourceNostr || config.nostrAuthMode !== 'nip07'}
                  />
                  {t('sourceNostr')}
                </label>
              )}
              {config.sourceBluesky && (
                <label className="post-dest-checkbox">
                  <input
                    type="checkbox"
                    checked={postToBluesky}
                    onChange={(e) => setPostToBluesky(e.target.checked)}
                    disabled={!config.sourceBluesky || !config.blueskyAppKey}
                  />
                  {t('sourceBluesky')}
                </label>
              )}
              {config.sourceMisskey && (
                <label className="post-dest-checkbox">
                  <input
                    type="checkbox"
                    checked={postToMisskey}
                    onChange={(e) => setPostToMisskey(e.target.checked)}
                    disabled={!config.sourceMisskey || !config.misskeyAccessToken}
                  />
                  {t('sourceMisskey')}
                </label>
              )}
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
            if (note.source === 'bluesky' || note.source === 'misskey' || note.source === 'discord' || note.source === 'test') {
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
                    title={note.source === 'nostr' ? 'Open in Nostr' : note.source === 'bluesky' ? 'Open in Bluesky' : note.source === 'misskey' ? 'Open in Misskey' : 'Discord'}
                  >
                    {note.source === 'nostr' ? (
                      <svg viewBox="971 163 1062 1239" className="icon-nostr">
                        <path d="M0 0 C0.89976562 0.01804688 1.79953125 0.03609375 2.7265625 0.0546875 C20.33557125 1.02977919 35.68639512 12.63806932 48.39453125 23.8671875 C63.22929261 36.90342353 77.66086504 44.5548803 97.16796875 48.66796875 C107.26649786 50.82354094 116.23551834 55.26453053 122.09375 64.0859375 C123 66 123 66 123.25 69.1875 C121.07828203 74.07386543 118.25586454 75.98932801 113.53417969 78.10473633 C100.83502873 82.434362 87.6744545 81.32646019 74.4375 81.0625 C39.43292768 79.14722747 39.43292768 79.14722747 8 92 C1.62067443 100.56950274 0.56009062 109.55697125 2 120 C3.55409853 124.41273231 5.94559166 127.48694248 9 131 C9.5043457 131.58523438 10.00869141 132.17046875 10.52832031 132.7734375 C16.88843941 140.07621046 23.52125902 146.80218676 31.16796875 152.76953125 C34.47368403 155.37306701 37.6376083 158.11494683 40.8125 160.875 C45.46789468 164.89994345 50.20211718 168.78783944 55.0625 172.5625 C61.87321584 177.85433395 68.48128153 183.35314414 75 189 C76.38058594 190.19302734 76.38058594 190.19302734 77.7890625 191.41015625 C82.96202567 195.96580207 87.6609063 200.64537374 92 206 C92.77085938 206.93328125 93.54171875 207.8665625 94.3359375 208.828125 C100.94291489 216.99686844 106.22505841 225.65234403 111 235 C111.55558594 236.08410156 112.11117188 237.16820312 112.68359375 238.28515625 C117.83202227 249.290758 120.4041868 261.17943766 123 273 C123.19940186 273.85851562 123.39880371 274.71703125 123.60424805 275.6015625 C125.35546302 283.90130742 125.35351466 292.18519676 125.3125 300.625 C125.31100952 301.38111572 125.30951904 302.13723145 125.3079834 302.91625977 C125.26886226 313.93907945 124.60617476 324.25664206 122 335 C121.74594611 336.37355151 121.50015393 337.74865128 121.26171875 339.125 C114.81534656 374.53808365 94.32953837 408.44014853 70.15625 434.65625 C68.7376983 436.19815402 67.34094388 437.76044937 65.96875 439.34375 C56.10850313 450.67567551 44.81029066 460.74604931 33 470 C32.05511719 470.75152344 31.11023437 471.50304687 30.13671875 472.27734375 C13.67789555 485.18089383 -3.6551382 496.73001429 -21.765625 507.17578125 C-30.53262564 512.32989692 -37.22924583 517.12727311 -40.36621094 527.08032227 C-41.78129165 533.59917829 -41.79804489 540.35265646 -42.0625 547 C-43.90493332 589.92823229 -52.81973558 634.23543761 -84 666 C-85.11955078 667.15628906 -85.11955078 667.15628906 -86.26171875 668.3359375 C-97.94379302 679.65113671 -112.90830644 684.83873535 -128 690 C-129.37937744 690.47953125 -129.37937744 690.47953125 -130.78662109 690.96875 C-171.7770587 705.19488391 -214.48617532 715.3942397 -257.25 722.6875 C-271.77424298 725.18699215 -285.39135626 728.00513372 -298 736 C-298.84594727 736.51191895 -298.84594727 736.51191895 -299.70898438 737.03417969 C-314.06447314 745.7374808 -324.63782625 756.88376014 -335 770 C-335.96877272 771.18180833 -336.94030229 772.36136026 -337.9140625 773.5390625 C-350.18189663 788.40508117 -361.58992514 803.91292468 -372.81640625 819.57421875 C-374.95029875 822.55010885 -377.10474522 825.50928774 -379.27734375 828.45703125 C-384.93884893 836.16267283 -390.33701581 843.95377324 -395.40234375 852.06640625 C-395.94564331 852.93172974 -396.48894287 853.79705322 -397.04870605 854.68859863 C-398.36819305 856.79091831 -399.68524915 858.89471648 -401 861 C-400.3634549 860.79812576 -399.72690979 860.59625153 -399.07107544 860.38825989 C-392.35441894 858.2588335 -385.63634258 856.13393118 -378.91748047 854.01147461 C-376.42103109 853.22223405 -373.92492761 852.43189837 -371.42919922 851.64038086 C-359.24046677 847.77548194 -347.06614979 843.92339125 -334.72305298 840.57844543 C-329.23695781 839.08826923 -323.86548231 837.37265853 -318.5 835.5 C-311.1856673 833.0022577 -303.84973716 830.7792051 -296.38671875 828.7734375 C-290.44756282 827.16425443 -284.66712378 825.24089702 -278.84375 823.25 C-273.85100877 821.58575292 -268.76962807 820.24981471 -263.69140625 818.875 C-258.89935709 817.56435408 -254.20115907 816.10723387 -249.5 814.5 C-243.38283285 812.41105249 -237.22582626 810.63959918 -230.98803711 808.94970703 C-225.29949655 807.39514267 -219.67901157 805.67123918 -214.0625 803.875 C-212.84953247 803.49299438 -212.84953247 803.49299438 -211.61206055 803.10327148 C-208.41070507 802.09505131 -205.22446476 801.07999542 -202.0625 799.953125 C-187.48867128 795.12554424 -169.81357723 796.89645928 -156.25 803.6875 C-147.79575882 808.19377007 -141.9963364 815.90205347 -136.8828125 823.78515625 C-136.06972122 825.01328285 -136.06972122 825.01328285 -135.24020386 826.26622009 C-133.52626296 828.85925874 -131.82537156 831.46054849 -130.125 834.0625 C-128.9943628 835.77857043 -127.86285798 837.49406956 -126.73046875 839.20898438 C-124.5173829 842.56271084 -122.30933163 845.91966334 -120.10522461 849.27929688 C-117.3036112 853.54558273 -114.47524323 857.79337257 -111.63671875 862.03515625 C-107.5809924 868.10269222 -103.60322817 874.21593273 -99.6875 880.375 C-99.10677734 881.28121094 -98.52605469 882.18742187 -97.92773438 883.12109375 C-96.26364273 885.73475182 -94.62441724 888.36152799 -93 891 C-92.50129395 891.80115234 -92.00258789 892.60230469 -91.48876953 893.42773438 C-88.78157814 897.9829659 -87.34086566 901.31291009 -87.5 906.75 C-87.5103125 907.81734375 -87.520625 908.8846875 -87.53125 909.984375 C-88.05552117 913.35718622 -88.96233271 915.27832702 -91 918 C-96.22329023 921.02950833 -101.0080785 921.91334147 -107 921 C-113.26962204 918.97921273 -118.94956941 915.66366843 -123.91015625 911.33203125 C-133.3987454 903.25553703 -143.48300614 901.79554358 -155.53662109 901.35083008 C-165.2299233 900.95600988 -173.61983282 898.6270889 -181 892 C-185.13818026 887.22923167 -187.21984597 882.29193857 -189.0625 876.3125 C-191.08831574 869.24227823 -191.08831574 869.24227823 -196 864 C-207.75326198 861.75201164 -219.93832875 866.85246145 -230.87109375 870.62109375 C-240.9372764 874.04001746 -251.17591044 876.94656895 -261.375 879.9375 C-269.74527453 882.40161967 -278.04251676 884.97003999 -286.296875 887.796875 C-290.87304079 889.28364616 -295.49161277 890.57989367 -300.125 891.875 C-308.31440233 894.16669378 -316.37327636 896.73622993 -324.42456055 899.47094727 C-329.56584895 901.21020063 -334.71631264 902.83194286 -339.9375 904.3125 C-349.41042409 907.009652 -358.72531706 910.19570459 -368.05444336 913.34692383 C-373.96026023 915.33728629 -379.86423511 917.27199903 -385.83984375 919.04296875 C-391.25038296 920.69185964 -396.25131503 922.73994083 -401.3125 925.25 C-402.11300781 925.63696045 -402.91351562 926.0239209 -403.73828125 926.42260742 C-408.3429073 928.65798215 -412.91097161 930.96276059 -417.47265625 933.28417969 C-439.3136995 944.36251232 -439.3136995 944.36251232 -451.5625 941.375 C-461.72917346 937.81666429 -468.92283372 931.40476282 -473.84375 921.90625 C-480.54753445 905.0561972 -477.33027205 885.90196734 -470.37890625 869.6796875 C-467.41203701 863.04082083 -464.24697642 856.50575223 -461 850 C-460.60119629 849.19675293 -460.20239258 848.39350586 -459.79150391 847.56591797 C-453.17361055 834.36290785 -445.52260731 821.69979492 -438 809 C-437.46938965 808.1028125 -436.9387793 807.205625 -436.39208984 806.28125 C-426.7656705 790.03227015 -416.7024931 774.07349661 -406.38842773 758.25317383 C-404.05524694 754.70801466 -404.05524694 754.70801466 -402 751 C-432.88642884 762.76064298 -462.90584524 774.49057097 -488.90478516 795.32958984 C-491.82272812 797.65592004 -494.78321146 799.92404891 -497.75 802.1875 C-503.35773298 806.49356347 -508.92401199 810.84978314 -514.4765625 815.2265625 C-516.77844308 817.04089639 -519.08560629 818.84808591 -521.3984375 820.6484375 C-527.96132234 825.76419447 -534.44773162 830.96460711 -540.875 836.25 C-541.56440674 836.81630127 -542.25381348 837.38260254 -542.96411133 837.96606445 C-547.1277752 841.40395665 -551.21763188 844.91374822 -555.26098633 848.49243164 C-556.73757024 849.77249702 -558.269954 850.987742 -559.8125 852.1875 C-562.14674078 855.18866672 -562.53966342 856.78584714 -563.3125 860.4375 C-566.33190426 874.2721715 -575.34382481 886.39127163 -586.99609375 894.21875 C-590.57861515 896.34310599 -594.25682653 898.17856063 -598 900 C-621.78157812 911.57277959 -634.73975079 932.60836582 -649.75390625 953.50390625 C-653.13212218 958.19684288 -656.56274602 962.85021051 -660 967.5 C-664.53761528 973.64008391 -669.0396668 979.80354805 -673.5 986 C-680.84003533 996.19356463 -688.30454606 1006.29401627 -695.77050781 1016.39550781 C-702.59965419 1025.63804661 -709.3920693 1034.9038828 -716.10571289 1044.23071289 C-720.61431413 1050.4862521 -725.18680605 1056.69318346 -729.76953125 1062.89453125 C-733.71415511 1068.23857821 -737.61958115 1073.60918549 -741.5 1079 C-747.6832568 1087.58707417 -753.95360662 1096.10791461 -760.24267578 1104.61767578 C-761.9775979 1106.9696305 -763.70655144 1109.32584839 -765.43359375 1111.68359375 C-773.57408834 1122.78784379 -781.86549019 1133.76902174 -790.24316406 1144.6953125 C-791.75777788 1146.68224335 -793.25546019 1148.67968659 -794.7421875 1150.6875 C-799.69381383 1157.31131489 -804.9946532 1163.34397041 -810.67919922 1169.34082031 C-824.25764394 1183.67546747 -838.08406845 1198.98811994 -846.33984375 1217.078125 C-846.76716797 1218.00689453 -847.19449219 1218.93566406 -847.63476562 1219.89257812 C-848.48544639 1221.75846412 -849.31959631 1223.63200046 -850.13476562 1225.51367188 C-852.73833135 1231.25670746 -855.42818998 1235.76654611 -861 1239 C-865.11308264 1240.00006373 -868.84844615 1239.78542911 -873 1239 C-877.71407113 1235.72901187 -880.28597426 1231.11216736 -881.56640625 1225.53125 C-884.92247759 1198.19892126 -878.07306191 1175.42620589 -866.06567383 1151.25732422 C-861.20003368 1140.95086172 -862.52070676 1131.22516602 -865 1120.4375 C-867.25267712 1110.60175708 -869.54330527 1100.11963125 -864 1091 C-854.70942524 1078.07184571 -840.52277917 1076.42306847 -825.70703125 1073.90917969 C-807.102255 1070.71541974 -796.67183728 1063.0406579 -786 1048 C-783.29099806 1044.14885747 -780.63057606 1040.26557236 -777.984375 1036.37109375 C-774.70324564 1031.54765694 -771.35266783 1026.7738679 -768 1022 C-763.80417394 1016.01964446 -759.62845484 1010.02706979 -755.5 1004 C-750.89129416 997.27384939 -746.22427992 990.58983957 -741.54296875 983.9140625 C-737.01349586 977.453191 -732.50297546 970.97936267 -728 964.5 C-722.44538378 956.50845979 -716.874469 948.52863727 -711.2890625 940.55859375 C-706.16840706 933.24833677 -701.06971621 925.92290027 -695.98071289 918.59057617 C-692.71353947 913.88624367 -689.43424557 909.1916226 -686.12109375 904.51953125 C-672.57926127 886.22071026 -672.57926127 886.22071026 -664.72241211 865.15307617 C-661.61461498 849.30312573 -654.71609656 837.07045145 -643 826 C-642.1330249 825.16251221 -642.1330249 825.16251221 -641.24853516 824.30810547 C-636.09902973 819.53154473 -630.61014292 816.4171341 -624.375 813.25 C-615.03365176 808.32537954 -606.9780482 802.87585016 -599 796 C-597.88402027 795.05976253 -596.76681813 794.12097416 -595.6484375 793.18359375 C-593.45495765 791.3405723 -591.27099607 789.48716222 -589.09375 787.625 C-586.2044868 785.16084036 -583.26481542 782.76339 -580.3125 780.375 C-575.91342167 776.79716785 -571.70449622 773.0544148 -567.515625 769.234375 C-564.98669705 766.98818434 -562.38950086 764.86468782 -559.75 762.75 C-554.66407431 758.63797498 -549.87663563 754.26566059 -545.12207031 749.78027344 C-542.22565037 747.05033393 -539.29914519 744.38391083 -536.27734375 741.79296875 C-531.3872197 737.53843735 -526.79767797 732.98374931 -522.21679688 728.40209961 C-520.74365752 726.93116703 -519.26265893 725.46845754 -517.78125 724.00585938 C-516.82763637 723.05517739 -515.87449452 722.10402187 -514.921875 721.15234375 C-514.07206055 720.30663818 -513.22224609 719.46093262 -512.34667969 718.58959961 C-509.09682357 715.00332997 -506.32319545 711.75961967 -505.4375 706.9375 C-506.23342526 702.78100144 -507.66157042 701.60397507 -511 699 C-517.73119233 694.47947294 -525.20918036 692.78549982 -532.98193359 690.9453125 C-541.6582004 688.88994527 -550.14358732 686.32667237 -558.6640625 683.70996094 C-561.4931437 682.85011895 -564.33181762 682.02681043 -567.17285156 681.20751953 C-602.58616014 670.96804373 -636.38629639 658.69293759 -666.9375 637.625 C-687.75942365 623.63590178 -715.40741182 626.24900344 -738.9440918 630.74414062 C-762.21995375 635.57206419 -782.26944478 645.56335006 -801.57373047 659.3269043 C-812.17496074 666.78136773 -824.91206375 671.32246963 -838 670 C-844.92226157 668.31408369 -851.00880764 665.08040371 -857.1875 661.625 C-858.13222168 661.10260742 -859.07694336 660.58021484 -860.05029297 660.04199219 C-928.54868024 621.92568014 -928.54868024 621.92568014 -936.38916016 594.6652832 C-937.35160283 590.46584807 -937.49101316 586.42004826 -937.4375 582.125 C-937.42702637 581.21862793 -937.41655273 580.31225586 -937.40576172 579.37841797 C-936.53812422 546.24156072 -919.73817727 515.49596211 -896.15234375 492.84765625 C-883.63575474 481.26797245 -867.307887 472.71815722 -851 468 C-849.45598442 467.48617186 -847.91414364 466.96574268 -846.375 466.4375 C-824.32073272 459.11247406 -801.80886599 454.90429714 -778.75 452.375 C-776.83640299 452.15995208 -774.92282901 451.9446991 -773.00927734 451.72924805 C-756.92638537 449.93394489 -740.87422654 448.37138859 -724.70703125 447.58203125 C-644.93007191 443.71947353 -644.93007191 443.71947353 -569.80957031 418.90771484 C-568.02428141 418.01218002 -566.22701032 417.14066255 -564.4296875 416.26953125 C-554.83044535 411.59323819 -545.45644468 406.50390755 -536.06494141 401.42675781 C-488.75886127 375.8665997 -440.42792272 355.38690582 -388 343 C-386.34344343 342.59108368 -384.6871535 342.18108419 -383.03125 341.76953125 C-374.45084097 339.69012708 -365.78937761 338.25793195 -357.0625 336.9375 C-355.57411621 336.71175293 -355.57411621 336.71175293 -354.05566406 336.48144531 C-350.37494001 335.9500772 -346.68886128 335.47042187 -343 335 C-342.07072693 334.8778714 -341.14145386 334.7557428 -340.184021 334.62991333 C-324.07203741 332.54304318 -308.1941416 331.49296496 -291.94775391 331.55395508 C-288.49972307 331.56250069 -285.05333975 331.53345726 -281.60546875 331.50195312 C-257.66436212 331.42641844 -234.86612166 334.99399163 -212 342 C-211.278125 342.2180127 -210.55625 342.43602539 -209.8125 342.66064453 C-205.88653945 343.8494001 -201.97651759 345.08232985 -198.07177734 346.33935547 C-195.7667545 347.07437689 -193.4562223 347.79014162 -191.14453125 348.50390625 C-183.93014948 350.73856732 -176.78093248 352.95510302 -169.8125 355.8828125 C-165.77338731 357.48723782 -161.6687727 358.89038234 -157.5625 360.3125 C-150.7415973 362.67554204 -143.9520052 365.10505267 -137.1875 367.625 C-131.4696389 369.75375298 -125.73674408 371.79140833 -119.9375 373.6875 C-115.94552994 374.99690019 -112.01199644 376.34350482 -108.125 377.9375 C-94.17199527 383.62374906 -80.03500752 387.73771893 -65.42480469 391.37304688 C-63.39601125 391.89760804 -61.38621863 392.49493943 -59.3828125 393.109375 C-52.45165395 394.93420658 -45.36054906 395.16268667 -38.22265625 395.203125 C-37.41243515 395.20882507 -36.60221405 395.21452515 -35.7674408 395.22039795 C-34.06071244 395.22977924 -32.35396653 395.2363543 -30.6472168 395.24023438 C-28.09975496 395.24985924 -25.55312998 395.28091513 -23.00585938 395.3125 C-8.39140935 395.40907457 6.4646802 394.47198239 19.9375 388.3125 C20.72761475 387.96437256 21.51772949 387.61624512 22.33178711 387.25756836 C28.85818533 384.27933409 34.53446 380.66333978 40 376 C40.88171875 375.26652344 41.7634375 374.53304688 42.671875 373.77734375 C56.54480335 361.81296915 62.33582088 346.75572386 67.875 329.625 C68.30413696 328.30798096 68.30413696 328.30798096 68.74194336 326.96435547 C72.09018816 316.20048769 73.33384578 305.74930834 73.25 294.5 C73.25773437 293.46230469 73.26546875 292.42460937 73.2734375 291.35546875 C73.21779811 269.01625449 65.04711065 254.50012006 50.125 238.30859375 C48.16362106 236.17775744 46.26305255 234.00820396 44.375 231.8125 C38.71410952 225.33175642 32.52834259 219.59120954 26 214 C24.92167305 213.06924434 23.84356534 212.13823463 22.765625 211.20703125 C17.35789609 206.54486009 11.93448656 201.91888062 6.375 197.4375 C1.37113158 193.37415311 -3.36887906 189.07515918 -8.08984375 184.69140625 C-10.74053419 182.23996234 -13.42449333 179.83372423 -16.125 177.4375 C-43.00067379 153.17652494 -62.73157098 121.34683482 -65.17285156 84.3828125 C-65.92165767 66.81418522 -64.32959402 50.14255825 -57 34 C-56.4121875 32.66195312 -56.4121875 32.66195312 -55.8125 31.296875 C-49.29842354 17.32589522 -39.2482745 7.8144849 -25 2 C-16.89829649 -0.68344855 -8.43575165 -0.27448216 0 0 Z " transform="translate(1908,163)" />
                      </svg>
                    ) : note.source === 'bluesky' ? (
                      <svg viewBox="0 0 24 24" className="icon-bluesky">
                        <path d="M5.202 2.857C7.954 4.922 10.913 9.11 12 11.358c1.087-2.247 4.046-6.436 6.798-8.501C20.783 1.366 24 .213 24 3.883c0 .732-.42 6.156-.667 7.037-.856 3.061-3.978 3.842-6.755 3.37 4.854.826 6.089 3.562 3.422 6.299-5.065 5.196-7.28-1.304-7.847-2.97-.104-.305-.152-.448-.153-.327 0-.121-.05.022-.153.327-.568 1.666-2.782 8.166-7.847 2.97-2.667-2.737-1.432-5.473 3.422-6.3-2.777.473-5.899-.308-6.755-3.369C.42 10.04 0 4.615 0 3.883c0-3.67 3.217-2.517 5.202-1.026Z" />
                      </svg>
                    ) : note.source === 'discord' ? (
                      <svg viewBox="0 0 24 24" className="icon-discord">
                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 160 160" className="icon-misskey">
                        <g transform="matrix(0.28948,0,0,0.28948,-54.705,-30.7703)">
                          <path d="M256.418,188.976C248.558,188.944 240.758,190.308 233.379,193.013C220.308,197.613 209.533,205.888 201.091,217.802C193.02,229.329 188.977,242.195 188.977,256.409L188.977,508.89C188.977,527.332 195.52,543.29 208.576,556.732C222.032,569.803 237.99,576.331 256.418,576.331C275.259,576.331 291.204,569.803 304.274,556.747C317.73,543.291 324.441,527.332 324.441,508.89L324.441,462.983C324.584,453.04 334.824,455.655 340.01,462.983C349.691,479.76 372.36,494.119 394.193,494.119C416.026,494.119 438.005,482.196 448.375,462.983C452.304,458.354 463.377,450.455 464.52,462.983L464.52,508.89C464.52,527.332 471.047,543.29 484.104,556.732C497.574,569.803 513.511,576.331 531.953,576.331C550.78,576.331 566.739,569.803 579.809,556.747C593.265,543.291 599.977,527.332 599.977,508.89L599.977,256.409C599.977,242.195 595.752,229.329 587.309,217.802C579.224,205.874 568.653,197.613 555.597,193.013C547.912,190.314 540.228,188.976 532.543,188.976C511.788,188.976 494.301,197.046 480.073,213.188L411.636,293.281C410.107,294.438 405.006,303.247 394.178,303.247C383.379,303.247 378.868,294.439 377.325,293.296L308.297,213.188C294.47,197.046 277.173,188.976 256.418,188.976ZM682.904,188.983C666.763,188.983 652.926,194.748 641.404,206.271C630.261,217.413 624.691,231.054 624.691,247.196C624.691,263.338 630.261,277.174 641.404,288.697C652.926,299.839 666.763,305.41 682.904,305.41C699.046,305.41 712.88,299.839 724.412,288.697C735.935,277.174 741.693,263.338 741.693,247.196C741.693,231.054 735.935,217.413 724.412,206.271C712.88,194.748 699.046,188.983 682.904,188.983ZM683.473,316.947C667.331,316.947 653.495,322.713 641.972,334.236C630.449,345.768 624.691,359.602 624.691,375.744L624.691,518.118C624.691,534.259 630.449,548.095 641.972,559.618C653.504,570.761 667.341,576.331 683.473,576.331C699.624,576.331 713.27,570.761 724.412,559.618C735.935,548.095 741.693,534.259 741.693,518.118L741.693,375.744C741.693,359.593 735.935,345.759 724.412,334.236C713.261,322.713 699.614,316.947 683.473,316.947Z" />
                        </g>
                      </svg>
                    )}
                  </button>
                </span>
                <span className="note-text">
                  <span className="note-datetime">{formatDateTime(note.created_at)}</span>
                  {' '}
                  <span className="note-author">
                    @{name} {displayName}
                  </span>
                  <span className="note-content">{linkifyText(note.content)}</span>
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
        {wsDebugStatus?.enabled && (
          <div className={`ws-debug-status${wsDebugStatus.error ? ' error' : ''}`}>
            WS Debug: {wsDebugStatus.connected ? 'Connected' : wsDebugStatus.error || 'Connecting...'}
          </div>
        )}
      </div>

      <div className="config-row">
        {window.logStorageEnabled && (
          <button className="btn-export" onClick={() => window.exportLogs?.()}>
            <svg className="icon-export" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
            </svg>
          </button>
        )}
        <button className="btn-config" onClick={() => setShowConfig(true)}>
          <svg className="icon-config" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 0 C1.65 0 3.3 0 5 0 C5 1.65 5 3.3 5 5 C5.845625 5.103125 6.69125 5.20625 7.5625 5.3125 C11 6 11 6 14.625 7.6875 C17.82654161 9.34606398 17.82654161 9.34606398 20.4375 8.1875 C21.2109375 7.5996875 21.2109375 7.5996875 22 7 C22.99 8.32 23.98 9.64 25 11 C24.63132813 11.5775 24.26265625 12.155 23.8828125 12.75 C22.74179118 14.94632361 22.74179118 14.94632361 23.6796875 17 C24.27136719 17.99 24.27136719 17.99 24.875 19 C26.76082847 22.19716615 27 23.0334671 27 27 C28.65 27 30.3 27 32 27 C32 28.65 32 30.3 32 32 C30.35 32 28.7 32 27 32 C26.5196682 33.58298026 26.04078388 35.16639978 25.5625 36.75 C25.29566406 37.63171875 25.02882812 38.5134375 24.75390625 39.421875 C24.50511719 40.27265625 24.25632813 41.1234375 24 42 C23.76152344 42.70640625 23.52304687 43.4128125 23.27734375 44.140625 C22.73754596 46.33364833 22.73754596 46.33364833 25 49 C23.625 50.5 23.625 50.5 22 52 C21.34 52 20.68 52 20 52 C19.67 51.34 19.34 50.68 19 50 C15.88200997 50.75035741 12.81929597 51.63363411 9.75 52.5625 C8.85796875 52.83191406 7.9659375 53.10132813 7.046875 53.37890625 C6.37140625 53.58386719 5.6959375 53.78882813 5 54 C5 55.65 5 57.3 5 59 C3.35 59 1.7 59 0 59 C-0.495 56.525 -0.495 56.525 -1 54 C-2.41601714 53.51891725 -3.83284437 53.04021859 -5.25 52.5625 C-6.03890625 52.29566406 -6.8278125 52.02882812 -7.640625 51.75390625 C-11.95409589 50.1403235 -11.95409589 50.1403235 -16.25 50.9375 C-16.8275 51.288125 -17.405 51.63875 -18 52 C-18.66 51.34 -19.32 50.68 -20 50 C-19.814375 48.948125 -19.62875 47.89625 -19.4375 46.8125 C-18.91465198 42.25625299 -20.07295356 40.08533845 -22 36 C-22 34.68 -22 33.36 -22 32 C-23.65 32 -25.3 32 -27 32 C-27 30.35 -27 28.7 -27 27 C-25.35 27 -23.7 27 -22 27 C-21.8453125 25.14375 -21.8453125 25.14375 -21.6875 23.25 C-21.2576881 19.672448 -20.42223091 17.73817407 -18 15 C-18 14.34 -18 13.68 -18 13 C-18.66 12.67 -19.32 12.34 -20 12 C-19.67 10.68 -19.34 9.36 -19 8 C-16.33333333 8 -13.66666667 8 -11 8 C-9.44204002 7.55334936 -7.89933008 7.05059414 -6.375 6.5 C-2.19444444 5 -2.19444444 5 0 5 C0 3.35 0 1.7 0 0 Z M-13.5 17.375 C-17.373537 23.04203769 -17.00999204 29.43505177 -16 36 C-14.22132304 41.07078957 -11.06461941 44.95701345 -6.15625 47.37890625 C-0.3393508 49.05442613 5.73300152 48.74192677 11.4375 46.875 C15.97562098 43.55442367 19.61948805 39.52204781 21 34 C21.82644237 27.55598315 21.24219257 23.0197254 17.42578125 17.6875 C13.10639806 12.57524373 8.79278405 10.27470007 2.1875 9.625 C-4.26774154 9.84382175 -9.18295913 12.65260318 -13.5 17.375 Z" transform="translate(30,3)"/>
            <path d="M0 0 C3.125 0.375 3.125 0.375 6 1 C6.6875 3.3125 6.6875 3.3125 7 6 C5.875 7.875 5.875 7.875 4 9 C-0.42105263 8.57894737 -0.42105263 8.57894737 -2 7 C-2.1875 4.5625 -2.1875 4.5625 -2 2 C-1.34 1.34 -0.68 0.68 0 0 Z" transform="translate(30,28)"/>
          </svg>
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
                <div className="config-label">{t('configVolume')}</div>
                <div className="config-volume">
                  <input
                    type="range"
                    className="config-volume-slider"
                    min={0}
                    max={100}
                    value={config.volume * 100}
                    onChange={(e) => {
                      const newVolume = parseInt(e.target.value) / 100;
                      updateConfig({ volume: newVolume });
                      if (speechManager.current) {
                        speechManager.current.volume = newVolume;
                      }
                    }}
                    onMouseUp={() => {
                      if (!speechManager.current?.speaking) {
                        speechManager.current?.speak(t('volumePreview'), i18n.language);
                      }
                    }}
                    onTouchEnd={() => {
                      if (!speechManager.current?.speaking) {
                        speechManager.current?.speak(t('volumePreview'), i18n.language);
                      }
                    }}
                  />
                  <span className="config-volume-value">{Math.round(config.volume * 100)}%</span>
                </div>
              </div>

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
                <label className="config-checkbox">
                  <input
                    type="checkbox"
                    checked={config.sourceMisskey}
                    onChange={(e) => updateConfig({ sourceMisskey: e.target.checked })}
                  />
                  {t('sourceMisskey')}
                </label>
                {config.sourceMisskey && (
                  <div className="config-misskey-inputs">
                    <input
                      type="password"
                      className="config-input-text"
                      placeholder={t('misskeyAccessTokenPlaceholder')}
                      value={config.misskeyAccessToken}
                      onChange={(e) => updateConfig({ misskeyAccessToken: e.target.value })}
                    />
                  </div>
                )}
                <label className="config-checkbox">
                  <input
                    type="checkbox"
                    checked={config.sourceDiscord}
                    onChange={(e) => updateConfig({ sourceDiscord: e.target.checked })}
                  />
                  {t('sourceDiscord')}
                </label>
                {config.sourceDiscord && (
                  <div className="config-discord-inputs">
                    <input
                      type="text"
                      className="config-input-text"
                      placeholder={t('discordBotUrlPlaceholder')}
                      value={config.discordBotUrl}
                      onChange={(e) => updateConfig({ discordBotUrl: e.target.value })}
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

              <div className="config-section">
                <div className="config-label">{t('configReadingTargets')}</div>
                <label className="config-checkbox">
                  <input
                    type="checkbox"
                    checked={config.readEmoji}
                    onChange={(e) => updateConfig({ readEmoji: e.target.checked })}
                  />
                  {t('configReadEmoji')}
                </label>
                <label className="config-checkbox">
                  <input
                    type="checkbox"
                    checked={config.readCustomEmoji}
                    onChange={(e) => updateConfig({ readCustomEmoji: e.target.checked })}
                  />
                  {t('configReadCustomEmoji')}
                </label>
                <label className="config-checkbox">
                  <input
                    type="checkbox"
                    checked={config.readUrl}
                    onChange={(e) => updateConfig({ readUrl: e.target.checked })}
                  />
                  {t('configReadUrl')}
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
                <div className="config-label">{t('configTheme')}</div>
                <label className="config-radio">
                  <input
                    type="radio"
                    name="theme"
                    checked={config.theme === 'light'}
                    onChange={() => updateConfig({ theme: 'light' })}
                  />
                  {t('themeLight')}
                </label>
                <label className="config-radio">
                  <input
                    type="radio"
                    name="theme"
                    checked={config.theme === 'dark'}
                    onChange={() => updateConfig({ theme: 'dark' })}
                  />
                  {t('themeDark')}
                </label>
                <label className="config-radio">
                  <input
                    type="radio"
                    name="theme"
                    checked={config.theme === 'system'}
                    onChange={() => updateConfig({ theme: 'system' })}
                  />
                  {t('themeSystem')}
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

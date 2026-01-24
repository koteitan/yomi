import { logMisskey } from '../utils';

// Use proxy in development to avoid CORS issues
const MISSKEY_API = import.meta.env.DEV ? '/misskey-api' : 'https://misskey.io/api';
const MISSKEY_WS = 'wss://misskey.io/streaming';

export interface MisskeyProfile {
  id: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface MisskeyNote {
  id: string;
  user: MisskeyProfile;
  text: string | null;
  createdAt: string;
}

const TOKEN_KEY = 'misskey_token';

let accessToken: string | null = null;

// WebSocket streaming state
let ws: WebSocket | null = null;
let noteCallback: ((note: MisskeyNote) => void) | null = null;
let reconnectTimeout: number | null = null;
let channelId: string | null = null;

// Watchdog and reconnection state
let watchdogTimeout: number | null = null;
let reconnectAttempts = 0;
const WATCHDOG_INTERVAL = 60000; // 1 minute
const MAX_RECONNECT_DELAY = 60000; // 60 seconds max

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Calculate reconnect delay with exponential backoff
 * 1s, 2s, 4s, 8s, 16s, 32s, 60s (max)
 */
function getReconnectDelay(): number {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  return delay;
}

/**
 * Reset watchdog timer - call on every message received
 */
function resetWatchdog(): void {
  if (watchdogTimeout) {
    clearTimeout(watchdogTimeout);
  }
  watchdogTimeout = window.setTimeout(() => {
    logMisskey(' watchdog: no message for 60s, reconnecting...');
    if (ws && noteCallback) {
      ws.close();
    }
  }, WATCHDOG_INTERVAL);
}

/**
 * Clear watchdog timer
 */
function clearWatchdog(): void {
  if (watchdogTimeout) {
    clearTimeout(watchdogTimeout);
    watchdogTimeout = null;
  }
}

// Try to restore token from localStorage on load
try {
  const saved = localStorage.getItem(TOKEN_KEY);
  if (saved) {
    accessToken = saved;
    logMisskey(' token restored');
  }
} catch (e) {
  // Ignore errors
}

/**
 * Login to Misskey with access token
 */
export async function login(token: string): Promise<boolean> {
  try {
    // Verify token by fetching profile
    logMisskey(' login attempt, token length:', token.length);
    const res = await fetch(`${MISSKEY_API}/i`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ i: token }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      logMisskey(' login failed:', res.status, errorText);
      return false;
    }
    accessToken = token;
    localStorage.setItem(TOKEN_KEY, token);
    logMisskey(' logged in');
    return true;
  } catch (e) {
    console.error('[misskey] login error:', e);
    return false;
  }
}

/**
 * Logout from Misskey
 */
export function logout(): void {
  accessToken = null;
  localStorage.removeItem(TOKEN_KEY);
  disconnectStream();
}

/**
 * Check if logged in
 */
export function isLoggedIn(): boolean {
  return accessToken !== null;
}

/**
 * Get my profile
 */
export async function getMyProfile(): Promise<MisskeyProfile | null> {
  if (!accessToken) {
    logMisskey(' not logged in');
    return null;
  }

  try {
    const res = await fetch(`${MISSKEY_API}/i`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ i: accessToken }),
    });
    if (!res.ok) {
      logMisskey(' getMyProfile failed:', res.status);
      return null;
    }
    const data = await res.json();
    return {
      id: data.id,
      username: data.username,
      name: data.name,
      avatarUrl: data.avatarUrl,
    };
  } catch (e) {
    console.error('[misskey] getMyProfile error:', e);
    return null;
  }
}

/**
 * Get home timeline
 * If the fetched note is a renote/reply, wait 1s and fetch the next one
 */
export async function getTimeline(sinceId?: string): Promise<MisskeyNote[]> {
  if (!accessToken) {
    logMisskey(' not logged in, cannot get timeline');
    return [];
  }

  const notes: MisskeyNote[] = [];
  const startTime = Date.now();
  logMisskey(' getTimeline start');

  const MAX_ATTEMPTS = 20;
  let untilId: string | undefined = undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const body: Record<string, unknown> = {
        i: accessToken,
        limit: 1,
      };
      if (sinceId) {
        body.sinceId = sinceId;
      }
      if (untilId) {
        body.untilId = untilId;
      }

      const res = await fetch(`${MISSKEY_API}/notes/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        logMisskey(` getTimeline failed: ${res.status}, ${Date.now() - startTime}ms`);
        return notes;
      }

      logMisskey(` getTimeline fetch done: ${Date.now() - startTime}ms`);
      const data = await res.json();

      if (!data || data.length === 0) {
        logMisskey(` getTimeline: no more notes, ${Date.now() - startTime}ms`);
        break;
      }

      const note = data[0];

      // Skip if no text (e.g., renotes without comment) or is renote/reply
      if (!note.text || note.renoteId || note.replyId) {
        logMisskey(` getTimeline: skipping renote/reply, waiting 1s (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
        untilId = note.id;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      notes.push({
        id: note.id,
        user: {
          id: note.user.id,
          username: note.user.username,
          name: note.user.name,
          avatarUrl: note.user.avatarUrl,
        },
        text: note.text,
        createdAt: note.createdAt,
      });

      logMisskey(` getTimeline done: ${notes.length} notes in ${Date.now() - startTime}ms`);
      return notes;
    } catch (e) {
      console.error('[misskey] getTimeline error:', e);
      return notes;
    }
  }

  logMisskey(` getTimeline: max attempts reached, ${Date.now() - startTime}ms`);
  return notes;
}

/**
 * Peek latest note to check for new notes
 * Returns the id of the latest note, or null if no new notes
 */
export async function peekLatest(sinceId?: string): Promise<string | null> {
  if (!accessToken) {
    return null;
  }

  const startTime = Date.now();

  try {
    const body: Record<string, unknown> = {
      i: accessToken,
      limit: 1,
    };
    if (sinceId) {
      body.sinceId = sinceId;
    }

    const res = await fetch(`${MISSKEY_API}/notes/timeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      logMisskey(` peekLatest failed: ${res.status}, ${Date.now() - startTime}ms`);
      return null;
    }

    const data = await res.json();
    if (!data || data.length === 0) {
      logMisskey(` peekLatest: no new notes, ${Date.now() - startTime}ms`);
      return null;
    }

    logMisskey(` peekLatest: new note found, ${Date.now() - startTime}ms`);
    return data[0].id;
  } catch (e) {
    logMisskey(` peekLatest error: ${e}`);
    return null;
  }
}

/**
 * Create a note
 */
export async function createNote(text: string): Promise<boolean> {
  if (!accessToken) {
    logMisskey(' not logged in');
    return false;
  }

  try {
    const res = await fetch(`${MISSKEY_API}/notes/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        i: accessToken,
        text,
      }),
    });

    if (!res.ok) {
      logMisskey(' createNote failed:', res.status);
      return false;
    }

    logMisskey(' note created');
    return true;
  } catch (e) {
    console.error('[misskey] createNote error:', e);
    return false;
  }
}

/**
 * Create a reaction on a note
 */
export async function createReaction(noteId: string, reaction: string = '\u2764'): Promise<boolean> {
  if (!accessToken) {
    logMisskey(' not logged in');
    return false;
  }

  try {
    const res = await fetch(`${MISSKEY_API}/notes/reactions/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        i: accessToken,
        noteId,
        reaction,
      }),
    });

    if (!res.ok) {
      logMisskey(' createReaction failed:', res.status);
      return false;
    }

    logMisskey(' reaction created');
    return true;
  } catch (e) {
    console.error('[misskey] createReaction error:', e);
    return false;
  }
}

// ============================================
// WebSocket Streaming API
// ============================================

/**
 * Connect to Misskey streaming and subscribe to home timeline
 */
export function connectStream(onNote: (note: MisskeyNote) => void): void {
  if (!accessToken) {
    logMisskey(' connectStream: not logged in');
    return;
  }

  // Disconnect existing connection
  disconnectStream();

  noteCallback = onNote;
  channelId = generateId();

  const url = `${MISSKEY_WS}?i=${accessToken}`;
  logMisskey(' connectStream: connecting...');

  ws = new WebSocket(url);

  ws.onopen = () => {
    logMisskey(' connectStream: connected');

    // Reset reconnect attempts on successful connection
    reconnectAttempts = 0;

    // Start watchdog
    resetWatchdog();

    // Subscribe to home timeline
    if (ws && ws.readyState === WebSocket.OPEN) {
      const subscribeMsg = {
        type: 'connect',
        body: {
          channel: 'homeTimeline',
          id: channelId,
        },
      };
      ws.send(JSON.stringify(subscribeMsg));
      logMisskey(' connectStream: subscribed to homeTimeline');
    }
  };

  ws.onmessage = (event) => {
    // Reset watchdog on any message
    resetWatchdog();

    try {
      const data = JSON.parse(event.data);

      // Handle channel messages
      if (data.type === 'channel' && data.body?.type === 'note') {
        const rawNote = data.body.body;

        // Skip if no text, or is renote/reply
        if (!rawNote.text || rawNote.renoteId || rawNote.replyId) {
          return;
        }

        const note: MisskeyNote = {
          id: rawNote.id,
          user: {
            id: rawNote.user.id,
            username: rawNote.user.username,
            name: rawNote.user.name,
            avatarUrl: rawNote.user.avatarUrl,
          },
          text: rawNote.text,
          createdAt: rawNote.createdAt,
        };

        logMisskey(' stream: received note from', note.user.name || note.user.username);
        if (noteCallback) {
          noteCallback(note);
        }
      }
    } catch (e) {
      logMisskey(' stream: parse error:', e);
    }
  };

  ws.onerror = (error) => {
    logMisskey(' connectStream: error:', error);
  };

  ws.onclose = (event) => {
    logMisskey(' connectStream: closed, code:', event.code);
    ws = null;

    // Clear watchdog
    clearWatchdog();

    // Reconnect with exponential backoff if we still have a callback
    if (noteCallback) {
      const delay = getReconnectDelay();
      reconnectAttempts++;
      logMisskey(` connectStream: will reconnect in ${delay / 1000}s (attempt ${reconnectAttempts})...`);
      reconnectTimeout = window.setTimeout(() => {
        if (noteCallback) {
          connectStream(noteCallback);
        }
      }, delay);
    }
  };
}

/**
 * Disconnect from Misskey streaming
 */
export function disconnectStream(): void {
  noteCallback = null;

  // Clear watchdog
  clearWatchdog();

  // Reset reconnect attempts
  reconnectAttempts = 0;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (ws) {
    logMisskey(' disconnectStream: closing...');
    ws.close();
    ws = null;
  }

  channelId = null;
}

/**
 * Check if stream is connected
 */
export function isStreamConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

/**
 * Get Misskey connection status for debugging
 */
export function getMisskeyStatus(): {
  loggedIn: boolean;
  wsState: string;
  channelId: string | null;
  reconnectAttempts: number;
} {
  let wsState = 'disconnected';
  if (ws) {
    switch (ws.readyState) {
      case WebSocket.CONNECTING:
        wsState = 'connecting';
        break;
      case WebSocket.OPEN:
        wsState = 'open';
        break;
      case WebSocket.CLOSING:
        wsState = 'closing';
        break;
      case WebSocket.CLOSED:
        wsState = 'closed';
        break;
    }
  }
  return {
    loggedIn: accessToken !== null,
    wsState,
    channelId,
    reconnectAttempts,
  };
}

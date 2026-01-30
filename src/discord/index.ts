import { logDiscord } from '../utils';

export interface DiscordAuthor {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface DiscordMessage {
  type: 'message';
  id: string;
  channelId: string;
  author: DiscordAuthor;
  content: string;
  timestamp: string; // ISO 8601
}

// WebSocket state
let ws: WebSocket | null = null;
let messageCallback: ((message: DiscordMessage) => void) | null = null;
let reconnectTimeout: number | null = null;
let currentUrl: string | null = null;

// Watchdog and reconnection state
let watchdogTimeout: number | null = null;
let reconnectAttempts = 0;
const WATCHDOG_INTERVAL = 60000; // 1 minute
const MAX_RECONNECT_DELAY = 60000; // 60 seconds max

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
    logDiscord(' watchdog: no message for 60s, reconnecting...');
    if (ws && messageCallback && currentUrl) {
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

/**
 * Connect to Discord bot WebSocket server
 */
export function connectStream(url: string, onMessage: (message: DiscordMessage) => void): void {
  // Disconnect existing connection
  disconnectStream();

  messageCallback = onMessage;
  currentUrl = url;

  logDiscord(' connectStream: connecting to', url);

  ws = new WebSocket(url);

  ws.onopen = () => {
    logDiscord(' connectStream: connected');

    // Reset reconnect attempts on successful connection
    reconnectAttempts = 0;

    // Start watchdog
    resetWatchdog();
  };

  ws.onmessage = (event) => {
    // Reset watchdog on any message
    resetWatchdog();

    try {
      const data = JSON.parse(event.data);

      if (data.type === 'message') {
        const message: DiscordMessage = {
          type: 'message',
          id: data.id,
          channelId: data.channelId,
          author: {
            id: data.author.id,
            username: data.author.username,
            displayName: data.author.displayName,
            avatarUrl: data.author.avatarUrl,
          },
          content: data.content,
          timestamp: data.timestamp,
        };

        logDiscord(' stream: received message from', message.author.displayName);
        if (messageCallback) {
          messageCallback(message);
        }
      }
    } catch (e) {
      logDiscord(' stream: parse error:', e);
    }
  };

  ws.onerror = (error) => {
    logDiscord(' connectStream: error:', error);
  };

  ws.onclose = (event) => {
    logDiscord(' connectStream: closed, code:', event.code);
    ws = null;

    // Clear watchdog
    clearWatchdog();

    // Reconnect with exponential backoff if we still have a callback
    if (messageCallback && currentUrl) {
      const delay = getReconnectDelay();
      reconnectAttempts++;
      logDiscord(` connectStream: will reconnect in ${delay / 1000}s (attempt ${reconnectAttempts})...`);
      reconnectTimeout = window.setTimeout(() => {
        if (messageCallback && currentUrl) {
          connectStream(currentUrl, messageCallback);
        }
      }, delay);
    }
  };
}

/**
 * Disconnect from Discord bot WebSocket server
 */
export function disconnectStream(): void {
  messageCallback = null;
  currentUrl = null;

  // Clear watchdog
  clearWatchdog();

  // Reset reconnect attempts
  reconnectAttempts = 0;

  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (ws) {
    logDiscord(' disconnectStream: closing...');
    ws.close();
    ws = null;
  }
}

/**
 * Check if stream is connected
 */
export function isStreamConnected(): boolean {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

/**
 * Get Discord connection status for debugging
 */
export function getDiscordStatus(): {
  wsState: string;
  url: string | null;
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
    wsState,
    url: currentUrl,
    reconnectAttempts,
  };
}

// WebSocket Debug Mode
// Usage: Add ?ws=host:port to URL to forward all console output via WebSocket

export interface WsDebugStatus {
  enabled: boolean;
  url: string;
  connected: boolean;
  error: string | null;
}

// Global status accessible from other modules
declare global {
  interface Window {
    wsDebugStatus?: WsDebugStatus;
  }
}

const params = new URLSearchParams(window.location.search);
const wsParam = params.get('ws');

// Initialize status
window.wsDebugStatus = {
  enabled: !!wsParam,
  url: '',
  connected: false,
  error: null,
};

function updateStatus(updates: Partial<WsDebugStatus>) {
  window.wsDebugStatus = { ...window.wsDebugStatus!, ...updates };
  window.dispatchEvent(new CustomEvent('wsDebugStatusChange', { detail: window.wsDebugStatus }));
}

if (wsParam) {
  // Use wss:// for HTTPS pages, ws:// for HTTP
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${wsParam}`;
  updateStatus({ url: wsUrl });
  let ws: WebSocket | null = null;
  let messageQueue: string[] = [];
  let isConnected = false;

  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

  function connect() {
    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        isConnected = true;
        updateStatus({ connected: true, error: null });
        originalConsole.log('[wsDebug] connected to', wsUrl);
        // Send queued messages
        for (const msg of messageQueue) {
          ws?.send(msg);
        }
        messageQueue = [];
      };

      ws.onclose = () => {
        isConnected = false;
        updateStatus({ connected: false });
        originalConsole.log('[wsDebug] disconnected, reconnecting in 3s...');
        setTimeout(connect, 3000);
      };

      ws.onerror = (e) => {
        const errorMsg = `Connection failed to ${wsUrl}`;
        updateStatus({ error: errorMsg });
        originalConsole.error('[wsDebug] error:', e);
      };
    } catch (e) {
      originalConsole.error('[wsDebug] connection failed:', e);
      setTimeout(connect, 3000);
    }
  }

  function formatArgs(args: unknown[]): string {
    return args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(' ');
  }

  function sendLog(level: string, args: unknown[]) {
    const timestamp = new Date().toISOString();
    const message = JSON.stringify({
      timestamp,
      level,
      message: formatArgs(args),
    });

    if (isConnected && ws?.readyState === WebSocket.OPEN) {
      ws.send(message);
    } else {
      messageQueue.push(message);
      // Limit queue size
      if (messageQueue.length > 100) {
        messageQueue.shift();
      }
    }
  }

  // Override console methods
  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    sendLog('log', args);
  };

  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    sendLog('warn', args);
  };

  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    sendLog('error', args);
  };

  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    sendLog('info', args);
  };

  console.debug = (...args: unknown[]) => {
    originalConsole.debug(...args);
    sendLog('debug', args);
  };

  // Capture uncaught errors
  window.onerror = (message, source, lineno, colno, error) => {
    const errorInfo = `${message} at ${source}:${lineno}:${colno}`;
    sendLog('error', [errorInfo, error?.stack || '']);
    return false; // Let default handler run too
  };

  // Capture unhandled promise rejections
  window.onunhandledrejection = (event) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      sendLog('error', [`Unhandled rejection: ${reason.message}`, reason.stack || '']);
    } else {
      sendLog('error', ['Unhandled rejection:', reason]);
    }
  };

  // Start connection
  connect();
  originalConsole.log('[wsDebug] initializing, connecting to', wsUrl);
}

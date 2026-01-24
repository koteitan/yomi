// WebSocket Debug Mode
// Usage: Add ?ws=host:port to URL to forward all console output via WebSocket
// Log Export Mode: Add ?startmon to URL to enable log storage and export

export interface WsDebugStatus {
  enabled: boolean;
  url: string;
  connected: boolean;
  error: string | null;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

// Global status accessible from other modules
declare global {
  interface Window {
    wsDebugStatus?: WsDebugStatus;
    logStorage?: LogEntry[];
    logStorageEnabled?: boolean;
    exportLogs?: () => void;
  }
}

const params = new URLSearchParams(window.location.search);
const wsParam = params.get('ws');
const startmonParam = params.has('startmon');

// Initialize status
window.wsDebugStatus = {
  enabled: !!wsParam,
  url: '',
  connected: false,
  error: null,
};

// Initialize log storage
window.logStorageEnabled = startmonParam;
window.logStorage = [];

// Export logs function
window.exportLogs = () => {
  if (!window.logStorage || window.logStorage.length === 0) {
    alert('No logs to export');
    return;
  }

  const content = window.logStorage.map(entry => {
    const time = entry.timestamp.split('T')[1].split('.')[0];
    return `${time} [${entry.level}] ${entry.message}`;
  }).join('\n');

  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `yomi-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

function updateStatus(updates: Partial<WsDebugStatus>) {
  window.wsDebugStatus = { ...window.wsDebugStatus!, ...updates };
  window.dispatchEvent(new CustomEvent('wsDebugStatusChange', { detail: window.wsDebugStatus }));
}

// Only override console if ws or startmon is enabled
if (wsParam || startmonParam) {
  const originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    info: console.info.bind(console),
    debug: console.debug.bind(console),
  };

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

  function storeLog(level: string, message: string) {
    if (window.logStorageEnabled && window.logStorage) {
      window.logStorage.push({
        timestamp: new Date().toISOString(),
        level,
        message,
      });
      // Limit storage size
      if (window.logStorage.length > 10000) {
        window.logStorage.shift();
      }
    }
  }

  // WebSocket connection (only if wsParam is set)
  let ws: WebSocket | null = null;
  let messageQueue: string[] = [];
  let isConnected = false;

  function sendToWs(level: string, message: string) {
    if (!wsParam) return;

    const payload = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
    });

    if (isConnected && ws?.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      messageQueue.push(payload);
      if (messageQueue.length > 100) {
        messageQueue.shift();
      }
    }
  }

  function handleLog(level: string, args: unknown[]) {
    const message = formatArgs(args);
    storeLog(level, message);
    sendToWs(level, message);
  }

  // Override console methods
  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    handleLog('log', args);
  };

  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    handleLog('warn', args);
  };

  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    handleLog('error', args);
  };

  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    handleLog('info', args);
  };

  console.debug = (...args: unknown[]) => {
    originalConsole.debug(...args);
    handleLog('debug', args);
  };

  // Capture uncaught errors
  window.onerror = (message, source, lineno, colno, error) => {
    const errorInfo = `${message} at ${source}:${lineno}:${colno}`;
    const fullMessage = errorInfo + (error?.stack ? '\n' + error.stack : '');
    storeLog('error', fullMessage);
    sendToWs('error', fullMessage);
    return false;
  };

  // Capture unhandled promise rejections
  window.onunhandledrejection = (event) => {
    const reason = event.reason;
    let message: string;
    if (reason instanceof Error) {
      message = `Unhandled rejection: ${reason.message}${reason.stack ? '\n' + reason.stack : ''}`;
    } else {
      message = `Unhandled rejection: ${String(reason)}`;
    }
    storeLog('error', message);
    sendToWs('error', message);
  };

  // Connect to WebSocket if wsParam is set
  if (wsParam) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${wsParam}`;
    updateStatus({ url: wsUrl });

    function connect() {
      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          isConnected = true;
          updateStatus({ connected: true, error: null });
          originalConsole.log('[wsDebug] connected to', wsUrl);
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

        ws.onerror = () => {
          const errorMsg = `Connection failed to ${wsUrl}`;
          updateStatus({ error: errorMsg });
        };
      } catch (e) {
        originalConsole.error('[wsDebug] connection failed:', e);
        setTimeout(connect, 3000);
      }
    }

    connect();
    originalConsole.log('[wsDebug] initializing, connecting to', wsUrl);
  }

  if (startmonParam) {
    originalConsole.log('[logStorage] enabled, logs will be stored for export');
  }
}

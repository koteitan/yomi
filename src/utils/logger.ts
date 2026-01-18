let eventLogEnabled = false;

type LogCategory = 'bluesky' | 'nostr' | 'nostr-event' | 'bluesky-event' | 'reading' | 'speech' | 'app';

// Generic log function (kept for backward compatibility)
export function log(...args: unknown[]): void {
  if (eventLogEnabled) {
    console.log(...args);
  }
}

// Category-specific log functions
export function logBluesky(...args: unknown[]): void {
  if (eventLogEnabled) {
    console.log('[bluesky]', ...args);
  }
}

export function logNostr(...args: unknown[]): void {
  if (eventLogEnabled) {
    console.log('[nostr]', ...args);
  }
}

export function logNostrEvent(createdAt: number, authorName: string, content: string): void {
  if (eventLogEnabled) {
    const datetime = formatDateTime(createdAt);
    const truncatedContent = content.length > 50 ? content.slice(0, 50) + '...' : content;
    console.log(`[nostr-event] ${datetime} ${authorName}: ${truncatedContent}`);
  }
}

export function logBlueskyEvent(createdAt: string, authorName: string, content: string): void {
  if (eventLogEnabled) {
    const datetime = formatDateTimeFromISO(createdAt);
    const truncatedContent = content.length > 50 ? content.slice(0, 50) + '...' : content;
    console.log(`[bluesky-event] ${datetime} ${authorName}: ${truncatedContent}`);
  }
}

export function logReading(noteNo: number, lang: string, authorName: string, content: string): void {
  if (eventLogEnabled) {
    const truncatedContent = content.length > 50 ? content.slice(0, 50) + '...' : content;
    console.log(`[reading] #${noteNo}(${lang}) ${authorName}: ${truncatedContent}`);
  }
}

export function logSpeech(...args: unknown[]): void {
  if (eventLogEnabled) {
    console.log('[speech]', ...args);
  }
}

// Helper to format unix timestamp to datetime string
function formatDateTime(unixTimestamp: number): string {
  const date = new Date(unixTimestamp * 1000);
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Helper to format ISO string to datetime string
function formatDateTimeFromISO(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Helper to format subscription filters for logging (trim arrays to 1 element)
export function formatFilters(filters: unknown[]): string {
  return JSON.stringify(filters.map(f => {
    if (typeof f !== 'object' || f === null) return f;
    const trimmed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(f)) {
      if (Array.isArray(value) && value.length > 1) {
        trimmed[key] = [value[0], `...(${value.length})`];
      } else {
        trimmed[key] = value;
      }
    }
    return trimmed;
  }));
}

// Helper to format relays for logging (trim to first relay + count)
export function formatRelays(relays: string[]): string {
  if (relays.length <= 1) return relays.join(', ');
  return `${relays[0]} ...(${relays.length})`;
}

export function startmon(enable?: boolean): void {
  eventLogEnabled = enable !== undefined ? enable : !eventLogEnabled;
  console.log(`[yomi] event log ${eventLogEnabled ? 'enabled' : 'disabled'}`);
}

export function stopmon(): void {
  eventLogEnabled = false;
  console.log('[yomi] event log disabled');
}

// Expose to window for console debugging
(window as unknown as { startmon: typeof startmon; stopmon: typeof stopmon }).startmon = startmon;
(window as unknown as { startmon: typeof startmon; stopmon: typeof stopmon }).stopmon = stopmon;

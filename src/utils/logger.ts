let eventLogEnabled = false;

export function log(...args: unknown[]): void {
  if (eventLogEnabled) {
    console.log(...args);
  }
}

export function monevent(): void {
  eventLogEnabled = !eventLogEnabled;
  console.log(`[yomi] event log ${eventLogEnabled ? 'enabled' : 'disabled'}`);
}

// Expose to window for console debugging
(window as unknown as { monevent: typeof monevent }).monevent = monevent;

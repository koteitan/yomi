import { createRxNostr, createRxBackwardReq, createRxForwardReq } from 'rx-nostr';
import { verifier } from 'rx-nostr-crypto';
import type { Profile, NoteEvent } from './types';
import { BOOTSTRAP_RELAYS, getFallbackRelays } from './constants';
import { logNostr, formatRelays } from '../utils';
import { getMisskeyStatus } from '../misskey';

const rxNostr = createRxNostr({ verifier });

// Subscription tracking for debugging
interface SubRecord {
  index: number;
  type: 'forward' | 'backward';
  status: 'active' | 'finished';
  relays: string[];
  filters: object[];
}

let subIndex = 0;
const subHistory: SubRecord[] = [];

function trackSub(type: 'forward' | 'backward', relays: string[], filters: object[]): number {
  const index = subIndex++;
  subHistory.push({ index, type, status: 'active', relays, filters });
  return index;
}

function finishSub(index: number) {
  const record = subHistory.find((s) => s.index === index);
  if (record) {
    record.status = 'finished';
  }
}

function formatFilter(filter: object): string {
  const entries = Object.entries(filter);
  const trimmed = entries.slice(0, 3).map(([k, v]) => {
    if (Array.isArray(v) && v.length > 3) {
      return `${k}:[${v.slice(0, 3).join(',')},...(${v.length})]`;
    }
    return `${k}:${JSON.stringify(v)}`;
  });
  if (entries.length > 3) {
    trimmed.push('...');
  }
  return `{${trimmed.join(', ')}}`;
}

export function dumpsub() {
  console.log('=== Nostr Subscription History ===');
  for (const sub of subHistory) {
    const relaysStr = sub.relays.length > 3
      ? `[${sub.relays.slice(0, 3).join(', ')}, ...(${sub.relays.length})]`
      : `[${sub.relays.join(', ')}]`;
    const filtersStr = sub.filters.map(formatFilter).join(', ');
    console.log(`#${sub.index}:${sub.type}:${sub.status}:${relaysStr}:${filtersStr}`);
  }
  console.log(`=== Total: ${subHistory.length} subscriptions ===`);

  console.log('=== Misskey.io Status ===');
  const mk = getMisskeyStatus();
  console.log(`loggedIn:${mk.loggedIn}, ws:${mk.wsState}, channel:${mk.channelId || 'none'}, reconnects:${mk.reconnectAttempts}`);
}

// Expose to window for console debugging
(window as any).dumpsub = dumpsub;

export function addRelays(relays: string[]) {
  rxNostr.setDefaultRelays(relays);
}

export async function fetchRelayList(pubkey: string): Promise<string[]> {
  return new Promise((resolve) => {
    let kind10002Event: { created_at: number; relays: string[] } | null = null;
    let kind3Event: { created_at: number; relays: string[] } | null = null;
    let resolved = false;
    let shortTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const filter = { kinds: [10002, 3], authors: [pubkey], limit: 2 };
    const subIdx = trackSub('backward', BOOTSTRAP_RELAYS, [filter]);

    const doResolve = () => {
      if (resolved) return;
      resolved = true;
      if (shortTimeoutId) clearTimeout(shortTimeoutId);
      finishSub(subIdx);
      if (kind10002Event && kind10002Event.relays.length > 0) {
        resolve(kind10002Event.relays);
      } else if (kind3Event && kind3Event.relays.length > 0) {
        resolve(kind3Event.relays);
      } else {
        resolve(getFallbackRelays());
      }
    };

    rxNostr.setDefaultRelays(BOOTSTRAP_RELAYS);

    const req = createRxBackwardReq();
    rxNostr.use(req).subscribe({
      next: (packet) => {
        const event = packet.event;
        if (event.kind === 10002) {
          if (!kind10002Event || event.created_at > kind10002Event.created_at) {
            const eventRelays = event.tags
              .filter((tag) => tag[0] === 'r' && (!tag[2] || tag[2] !== 'read'))
              .map((tag) => tag[1]);
            kind10002Event = { created_at: event.created_at, relays: eventRelays };
            // Start short timeout after first kind:10002
            if (!shortTimeoutId) {
              shortTimeoutId = setTimeout(() => {
                req.over();
                doResolve();
              }, 1000);
            }
          }
        } else if (event.kind === 3) {
          if (!kind3Event || event.created_at > kind3Event.created_at) {
            try {
              const content = JSON.parse(event.content);
              const eventRelays = Object.keys(content).filter(
                (url) => url.startsWith('wss://') || url.startsWith('ws://')
              );
              kind3Event = { created_at: event.created_at, relays: eventRelays };
            } catch {
              // Invalid JSON content
            }
          }
        }
      },
      complete: () => {
        doResolve();
      },
    });

    req.emit([filter]);

    setTimeout(() => {
      req.over();
      doResolve();
    }, 5000);
  });
}

export async function fetchProfile(pubkey: string, relays: string[]): Promise<Profile> {
  return new Promise((resolve) => {
    let profile: Profile = { pubkey };
    let latestCreatedAt = 0;
    let resolved = false;
    let shortTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const useRelays = [...BOOTSTRAP_RELAYS, ...relays];
    const filter = { kinds: [0], authors: [pubkey], limit: 1 };
    const subIdx = trackSub('backward', useRelays, [filter]);

    const doResolve = () => {
      if (!resolved) {
        resolved = true;
        if (shortTimeoutId) clearTimeout(shortTimeoutId);
        finishSub(subIdx);
        resolve(profile);
      }
    };

    rxNostr.setDefaultRelays(useRelays);

    const req = createRxBackwardReq();
    rxNostr.use(req).subscribe({
      next: (packet) => {
        const event = packet.event;
        if (event.kind === 0 && event.created_at > latestCreatedAt) {
          latestCreatedAt = event.created_at;
          try {
            const content = JSON.parse(event.content);
            profile = {
              pubkey,
              name: content.name,
              display_name: content.display_name,
              picture: content.picture,
            };
            // Start short timeout after first result
            if (!shortTimeoutId) {
              shortTimeoutId = setTimeout(() => {
                req.over();
                doResolve();
              }, 1000);
            }
          } catch {
            // Invalid JSON
          }
        }
      },
      complete: () => {
        doResolve();
      },
    });

    req.emit([filter]);

    setTimeout(() => {
      req.over();
      doResolve();
    }, 5000);
  });
}

export async function fetchFollowList(pubkey: string, relays: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    let followList: string[] = [];
    let latestCreatedAt = 0;
    let resolved = false;
    let shortTimeoutId: ReturnType<typeof setTimeout> | null = null;

    const useRelays = [...BOOTSTRAP_RELAYS, ...relays];
    const filter = { kinds: [3], authors: [pubkey], limit: 1 };
    const subIdx = trackSub('backward', useRelays, [filter]);

    const doResolve = () => {
      if (!resolved) {
        resolved = true;
        if (shortTimeoutId) clearTimeout(shortTimeoutId);
        finishSub(subIdx);
        resolve(followList);
      }
    };

    rxNostr.setDefaultRelays(useRelays);

    const req = createRxBackwardReq();
    rxNostr.use(req).subscribe({
      next: (packet) => {
        const event = packet.event;
        if (event.kind === 3 && event.created_at > latestCreatedAt) {
          latestCreatedAt = event.created_at;
          followList = event.tags
            .filter((tag) => tag[0] === 'p')
            .map((tag) => tag[1]);
          // Start short timeout after first kind:3
          if (!shortTimeoutId) {
            shortTimeoutId = setTimeout(() => {
              req.over();
              doResolve();
            }, 1000);
          }
        }
      },
      complete: () => {
        doResolve();
      },
    });

    req.emit([filter]);

    setTimeout(() => {
      req.over();
      doResolve();
    }, 5000);
  });
}

export async function fetchProfiles(
  pubkeys: string[],
  relays: string[],
  onProfile: (profile: Profile) => void
): Promise<void> {
  return new Promise((resolve) => {
    const profiles = new Map<string, Profile>();
    let resolved = false;

    // Build filters for tracking
    const filters: object[] = [];
    for (let i = 0; i < pubkeys.length; i += 200) {
      const chunk = pubkeys.slice(i, i + 200);
      filters.push({ kinds: [0], authors: chunk, limit: 200 });
    }
    const subIdx = trackSub('backward', relays, filters);

    const doResolve = () => {
      if (!resolved) {
        resolved = true;
        finishSub(subIdx);
        resolve();
      }
    };

    rxNostr.setDefaultRelays(relays);

    const req = createRxBackwardReq();
    rxNostr.use(req).subscribe({
      next: (packet) => {
        const event = packet.event;
        if (event.kind === 0) {
          const existing = profiles.get(event.pubkey);
          if (!existing || event.created_at > (existing as any)._created_at) {
            try {
              const content = JSON.parse(event.content);
              const profile: Profile & { _created_at?: number } = {
                pubkey: event.pubkey,
                name: content.name,
                display_name: content.display_name,
                picture: content.picture,
                _created_at: event.created_at,
              };
              profiles.set(event.pubkey, profile);
              onProfile(profile);
            } catch {
              // Invalid JSON
            }
          }
        }
      },
      complete: () => {
        doResolve();
      },
    });

    // Emit all filters
    for (const filter of filters) {
      req.emit([filter as any]);
    }

    setTimeout(() => {
      req.over();
      doResolve();
    }, 10000);
  });
}

export function subscribeToNotes(
  followList: string[],
  relays: string[],
  onNote: (note: NoteEvent, shouldReplace: boolean) => void
): () => void {
  // Build filters for tracking
  const filters: object[] = [];
  for (let i = 0; i < followList.length; i += 1000) {
    const chunk = followList.slice(i, i + 1000);
    filters.push({ kinds: [1], authors: chunk, limit: 1 });
  }
  const subIdx = trackSub('forward', relays, filters);

  rxNostr.setDefaultRelays(relays);

  let eoseReceived = false;
  let newestTimestamp = 0; // Track newest note timestamp seen
  let eoseTimeout: ReturnType<typeof setTimeout> | null = null;

  const markEoseReceived = () => {
    if (!eoseReceived) {
      eoseReceived = true;
      logNostr('EOSE timeout reached');
    }
  };

  const req = createRxForwardReq();
  const subscription = rxNostr.use(req).subscribe({
    next: (packet) => {
      const event = packet.event;
      if (event.kind === 1) {
        const note: NoteEvent = {
          id: event.id,
          pubkey: event.pubkey,
          content: event.content,
          created_at: event.created_at,
          tags: event.tags,
        };

        if (!eoseReceived) {
          // Before EOSE: only keep the newest note
          if (note.created_at > newestTimestamp) {
            newestTimestamp = note.created_at;
            onNote(note, true); // shouldReplace = true
          }
          // Start/reset EOSE timeout (1 second after first event)
          if (eoseTimeout) {
            clearTimeout(eoseTimeout);
          }
          eoseTimeout = setTimeout(markEoseReceived, 1000);
        } else {
          // After EOSE: only accept notes newer than what we've seen
          if (note.created_at > newestTimestamp) {
            newestTimestamp = note.created_at;
            onNote(note, false);
          }
        }
      }
    },
  });

  // Emit all filters
  for (const filter of filters) {
    req.emit([filter as any]);
  }

  return () => {
    if (eoseTimeout) {
      clearTimeout(eoseTimeout);
    }
    finishSub(subIdx);
    subscription.unsubscribe();
  };
}

export async function publishNote(content: string, relays: string[]): Promise<boolean> {
  if (!window.nostr) {
    console.error('NIP-07 not available');
    return false;
  }

  try {
    const event = {
      kind: 1,
      content,
      tags: [],
      created_at: Math.floor(Date.now() / 1000),
    };

    const signedEvent = await window.nostr.signEvent(event);
    logNostr('publish signed event:', signedEvent.id);

    rxNostr.setDefaultRelays(relays);
    rxNostr.send(signedEvent);
    logNostr('publish sent to', formatRelays(relays));

    return true;
  } catch (error) {
    console.error('[publish] error:', error);
    return false;
  }
}

export async function publishReaction(eventId: string, eventPubkey: string, relays: string[]): Promise<boolean> {
  if (!window.nostr) {
    console.error('NIP-07 not available');
    return false;
  }

  try {
    const event = {
      kind: 7,
      content: '+',
      tags: [
        ['e', eventId],
        ['p', eventPubkey],
      ],
      created_at: Math.floor(Date.now() / 1000),
    };

    const signedEvent = await window.nostr.signEvent(event);
    logNostr('reaction signed event:', signedEvent.id);

    rxNostr.setDefaultRelays(relays);
    rxNostr.send(signedEvent);
    logNostr('reaction sent to', formatRelays(relays));

    return true;
  } catch (error) {
    console.error('[reaction] error:', error);
    return false;
  }
}

export function cleanup() {
  rxNostr.dispose();
}

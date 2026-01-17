import { createRxNostr, createRxBackwardReq, createRxForwardReq } from 'rx-nostr';
import { verifier } from 'rx-nostr-crypto';
import type { Profile, NoteEvent } from './types';
import { BOOTSTRAP_RELAYS, getFallbackRelays } from './constants';

const rxNostr = createRxNostr({ verifier });

export function addRelays(relays: string[]) {
  rxNostr.setDefaultRelays(relays);
}

export async function fetchRelayList(pubkey: string): Promise<string[]> {
  return new Promise((resolve) => {
    let kind10002Event: { created_at: number; relays: string[] } | null = null;
    let kind3Event: { created_at: number; relays: string[] } | null = null;
    let resolved = false;

    const doResolve = () => {
      if (resolved) return;
      resolved = true;
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

    req.emit([{ kinds: [10002, 3], authors: [pubkey], limit: 2 }]);

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

    const doResolve = () => {
      if (!resolved) {
        resolved = true;
        resolve(profile);
      }
    };

    rxNostr.setDefaultRelays([...BOOTSTRAP_RELAYS, ...relays]);

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
          } catch {
            // Invalid JSON
          }
        }
      },
      complete: () => {
        doResolve();
      },
    });

    req.emit([{ kinds: [0], authors: [pubkey], limit: 1 }]);

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

    const doResolve = () => {
      if (!resolved) {
        resolved = true;
        resolve(followList);
      }
    };

    rxNostr.setDefaultRelays([...BOOTSTRAP_RELAYS, ...relays]);

    const req = createRxBackwardReq();
    rxNostr.use(req).subscribe({
      next: (packet) => {
        const event = packet.event;
        if (event.kind === 3 && event.created_at > latestCreatedAt) {
          latestCreatedAt = event.created_at;
          followList = event.tags
            .filter((tag) => tag[0] === 'p')
            .map((tag) => tag[1]);
        }
      },
      complete: () => {
        doResolve();
      },
    });

    req.emit([{ kinds: [3], authors: [pubkey], limit: 1 }]);

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

    const doResolve = () => {
      if (!resolved) {
        resolved = true;
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

    // Split into chunks of 200
    for (let i = 0; i < pubkeys.length; i += 200) {
      const chunk = pubkeys.slice(i, i + 200);
      req.emit([{ kinds: [0], authors: chunk, limit: 200 }]);
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
  onNote: (note: NoteEvent) => void
): () => void {
  rxNostr.setDefaultRelays(relays);

  const req = createRxForwardReq();
  const subscription = rxNostr.use(req).subscribe({
    next: (packet) => {
      const event = packet.event;
      if (event.kind === 1) {
        // Skip replies (has 'e' tag)
        const hasReplyTag = event.tags.some((tag) => tag[0] === 'e');
        if (hasReplyTag) return;

        onNote({
          id: event.id,
          pubkey: event.pubkey,
          content: event.content,
          created_at: event.created_at,
          tags: event.tags,
        });
      }
    },
  });

  // Split into chunks of 1000 authors
  for (let i = 0; i < followList.length; i += 1000) {
    const chunk = followList.slice(i, i + 1000);
    req.emit([{ kinds: [1], authors: chunk }]);
  }

  return () => {
    subscription.unsubscribe();
  };
}

export function cleanup() {
  rxNostr.dispose();
}

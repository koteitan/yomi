import { nip19 } from 'nostr-tools';

export function hexToNpub(hex: string): string {
  return nip19.npubEncode(hex);
}

export function hexToNevent(eventId: string): string {
  return nip19.neventEncode({ id: eventId });
}

export function parseHexOrNpub(input: string): string | null {
  const trimmed = input.trim();

  // Check if it's already a hex pubkey (64 hex chars)
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  // Try to decode as npub
  if (trimmed.startsWith('npub1')) {
    try {
      const decoded = nip19.decode(trimmed);
      if (decoded.type === 'npub') {
        return decoded.data;
      }
    } catch {
      return null;
    }
  }

  return null;
}

async function waitForNostr(maxAttempts = 10, interval = 100): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (window.nostr) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

export async function getNip07Pubkey(): Promise<string | null> {
  const hasNostr = await waitForNostr();
  if (!hasNostr || !window.nostr) {
    return null;
  }
  try {
    return await window.nostr.getPublicKey();
  } catch {
    return null;
  }
}

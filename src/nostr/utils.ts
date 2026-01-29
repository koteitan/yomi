import { npubEncode, neventEncode, nip19Decode } from './bech32';

export function hexToNpub(hex: string): string {
  return npubEncode(hex);
}

export function hexToNevent(eventId: string): string {
  return neventEncode({ id: eventId });
}

export function parseHexOrNpub(input: string): string | null {
  const trimmed = input.trim();

  // Check if it's already a hex pubkey (64 hex chars)
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  // Try to decode as npub
  if (trimmed.startsWith('npub1')) {
    const decoded = nip19Decode(trimmed);
    if (decoded && decoded.type === 'npub') {
      return decoded.data;
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

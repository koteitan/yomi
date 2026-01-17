export const BOOTSTRAP_RELAYS = [
  'wss://directory.yabu.me',
  'wss://purplepag.es',
  'wss://relay.nostr.band',
  'wss://indexer.coracle.social',
];

export const FALLBACK_RELAYS_JA = [
  'wss://yabu.me',
  'wss://nostr.compile-error.net',
  'wss://r.kojira.io',
  'wss://relay-jp.nostr.wirednet.jp',
  'wss://nrelay-jp.c-stellar.net',
  'wss://nostream.ocha.one',
  'wss://snowflare.cc',
];

export const FALLBACK_RELAYS_EN = [
  'wss://relay.damus.io',
  'wss://nostr-pub.wellorder.net',
  'wss://offchain.pub',
  'wss://relay.snort.social',
];

export function getFallbackRelays(): string[] {
  const lang = navigator.language || 'en';
  return lang.startsWith('ja') ? FALLBACK_RELAYS_JA : FALLBACK_RELAYS_EN;
}

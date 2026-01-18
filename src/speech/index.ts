import type { Profile } from '../nostr/types';
import { log } from '../utils';
import i18n from '../i18n';

// Image URL pattern (must be checked before general URL pattern)
const IMAGE_URL_PATTERN = /https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)(?:\?[^\s]*)?/gi;

// URL pattern
const URL_PATTERN = /https?:\/\/[^\s]+/g;

// Nostr bech32 patterns (npub, note, nevent, nprofile, naddr, etc.)
const NOSTR_BECH32_PATTERN = /(?:nostr:)?(n(?:pub|sec|profile|event|ote|addr|relay)1[a-z0-9]+)/gi;

// Hex pubkey pattern (64 hex chars that might be a pubkey reference)
const HEX_PUBKEY_PATTERN = /\b([0-9a-f]{64})\b/gi;

export function processTextForSpeech(
  text: string,
  profiles: Map<string, Profile>,
  urlLabel: string,
  imageUrlLabel: string,
  nostrAddressLabel: string
): string {
  let processed = text;

  // Replace image URLs with label (must be done before general URLs)
  processed = processed.replace(IMAGE_URL_PATTERN, imageUrlLabel);

  // Replace remaining URLs with label
  processed = processed.replace(URL_PATTERN, urlLabel);

  // Replace nostr: bech32 addresses with label
  processed = processed.replace(NOSTR_BECH32_PATTERN, nostrAddressLabel);

  // Replace hex pubkeys with profile names if available, otherwise with label
  processed = processed.replace(HEX_PUBKEY_PATTERN, (match) => {
    const profile = profiles.get(match.toLowerCase());
    if (profile) {
      const name = profile.display_name || profile.name;
      if (name) {
        return name;
      }
    }
    return nostrAddressLabel;
  });

  return processed;
}

export class SpeechManager {
  private synth: SpeechSynthesis;
  private isPaused = false;
  private onEndCallback: (() => void) | null = null;
  private isUnlocked = false;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private _volume = 1.0;

  constructor() {
    this.synth = window.speechSynthesis;
  }

  get volume(): number {
    return this._volume;
  }

  set volume(value: number) {
    this._volume = Math.max(0, Math.min(1, value));
  }

  // Call this on user interaction to unlock audio on iOS
  unlock(): void {
    if (this.isUnlocked) return;
    const utterance = new SpeechSynthesisUtterance('');
    utterance.volume = 0;
    this.synth.speak(utterance);
    this.isUnlocked = true;
    log('[speech]unlocked');
  }

  speak(text: string, lang: string, onEnd?: () => void, timeoutSeconds?: number): void {
    this.stop();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang || i18n.language || 'en';
    utterance.volume = this._volume;

    this.onEndCallback = onEnd || null;

    log('[speech]start:', text.slice(0, 50));

    const clearTimeoutIfSet = () => {
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
    };

    utterance.onend = () => {
      log('[speech]onend');
      clearTimeoutIfSet();
      if (this.onEndCallback) {
        this.onEndCallback();
      }
    };

    utterance.onerror = (event) => {
      log('[speech]onerror:', event.error);
      clearTimeoutIfSet();
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        console.error('Speech error:', event.error);
      }
      if (this.onEndCallback) {
        this.onEndCallback();
      }
    };

    this.isPaused = false;
    this.synth.speak(utterance);
    log('[speech]queued, speaking:', this.synth.speaking, 'pending:', this.synth.pending);

    // Set timeout to limit reading length
    if (timeoutSeconds && timeoutSeconds > 0) {
      this.timeoutId = setTimeout(() => {
        log('[speech]timeout reached, skipping');
        this.skip();
      }, timeoutSeconds * 1000);
    }
  }

  pause(): void {
    if (this.synth.speaking && !this.isPaused) {
      this.synth.pause();
      this.isPaused = true;
    }
  }

  resume(): void {
    if (this.isPaused) {
      this.synth.resume();
      this.isPaused = false;
    }
  }

  skip(): void {
    this.synth.cancel();
    // onEnd callback will be triggered by the cancel
  }

  stop(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.onEndCallback = null;
    this.synth.cancel();
    this.isPaused = false;
  }

  get speaking(): boolean {
    return this.synth.speaking;
  }

  get paused(): boolean {
    return this.isPaused;
  }
}

import type { Profile } from '../nostr/types';
import { log } from '../utils';

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
  nostrAddressLabel: string
): string {
  let processed = text;

  // Replace URLs with label
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

  constructor() {
    this.synth = window.speechSynthesis;
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

  speak(text: string, onEnd?: () => void): void {
    this.stop();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || 'en';

    this.onEndCallback = onEnd || null;

    log('[speech]start:', text.slice(0, 50));

    utterance.onend = () => {
      log('[speech]onend');
      if (this.onEndCallback) {
        this.onEndCallback();
      }
    };

    utterance.onerror = (event) => {
      log('[speech]onerror:', event.error);
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

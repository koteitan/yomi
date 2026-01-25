import type { Profile } from '../nostr/types';
import { logSpeech } from '../utils';
import i18n from '../i18n';

// Image URL pattern (must be checked before general URL pattern)
const IMAGE_URL_PATTERN = /https?:\/\/[^\s]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp|ico)(?:\?[^\s]*)?/gi;

// URL pattern
const URL_PATTERN = /https?:\/\/[^\s]+/g;

// Nostr bech32 patterns (npub, note, nevent, nprofile, naddr, etc.)
const NOSTR_BECH32_PATTERN = /(?:nostr:)?(n(?:pub|sec|profile|event|ote|addr|relay)1[a-z0-9]+)/gi;

// Hex pubkey pattern (64 hex chars that might be a pubkey reference)
const HEX_PUBKEY_PATTERN = /\b([0-9a-f]{64})\b/gi;

// Custom emoji pattern (shortcode format like :emoji_name:)
const CUSTOM_EMOJI_PATTERN = /:[a-zA-Z0-9_+-]+:/g;

// Unicode emoji pattern (covers most common emoji ranges)
const UNICODE_EMOJI_PATTERN = /[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{1FA00}-\u{1FAFF}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}\u{27BF}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{2B50}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}]+/gu;

export interface ReadingTargetOptions {
  readEmoji: boolean;
  readCustomEmoji: boolean;
  readUrl: boolean;
}

export function processTextForSpeech(
  text: string,
  profiles: Map<string, Profile>,
  urlLabel: string,
  imageUrlLabel: string,
  nostrAddressLabel: string,
  options?: ReadingTargetOptions
): string {
  let processed = text;

  // Default options: read everything
  const opts = options ?? { readEmoji: true, readCustomEmoji: true, readUrl: true };

  // Replace image URLs with label or remove (must be done before general URLs)
  processed = processed.replace(IMAGE_URL_PATTERN, opts.readUrl ? imageUrlLabel : '');

  // Replace remaining URLs with label or remove
  processed = processed.replace(URL_PATTERN, opts.readUrl ? urlLabel : '');

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

  // Remove custom emoji if disabled
  if (!opts.readCustomEmoji) {
    processed = processed.replace(CUSTOM_EMOJI_PATTERN, '');
  }

  // Remove unicode emoji if disabled
  if (!opts.readEmoji) {
    processed = processed.replace(UNICODE_EMOJI_PATTERN, '');
  }

  // Clean up multiple spaces
  processed = processed.replace(/\s+/g, ' ').trim();

  return processed;
}

export class SpeechManager {
  private synth: SpeechSynthesis;
  private isPaused = false;
  private onEndCallback: (() => void) | null = null;
  private isUnlocked = false;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private _volume = 1.0;
  private isReading = false; // Thread-safe flag to track reading state

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
    logSpeech('unlocked');
  }

  speak(text: string, lang: string, onEnd?: () => void, timeoutSeconds?: number): void {
    logSpeech('speak() called, isReading:', this.isReading);

    // Only cancel if we're currently reading (thread-safe check)
    if (this.isReading) {
      logSpeech('stopping previous speech');
      this.stop();
    } else {
      // Just clear timeout and callback without calling synth.cancel()
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
      this.onEndCallback = null;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = lang || i18n.language || 'en';
    utterance.volume = this._volume;

    this.onEndCallback = onEnd || null;

    logSpeech('start:', text.slice(0, 50));

    const clearTimeoutIfSet = () => {
      if (this.timeoutId) {
        clearTimeout(this.timeoutId);
        this.timeoutId = null;
      }
    };

    utterance.onend = () => {
      logSpeech('onend');
      this.isReading = false;
      clearTimeoutIfSet();
      if (this.onEndCallback) {
        this.onEndCallback();
      }
    };

    utterance.onerror = (event) => {
      logSpeech('onerror:', event.error);
      this.isReading = false;
      clearTimeoutIfSet();
      if (event.error !== 'interrupted' && event.error !== 'canceled') {
        console.error('Speech error:', event.error);
      }
      if (this.onEndCallback) {
        this.onEndCallback();
      }
    };

    // Set flag BEFORE calling synth.speak() for thread safety
    this.isReading = true;
    this.isPaused = false;
    this.synth.speak(utterance);
    logSpeech('queued, speaking:', this.synth.speaking, 'pending:', this.synth.pending);

    // Set timeout to limit reading length
    if (timeoutSeconds && timeoutSeconds > 0) {
      this.timeoutId = setTimeout(() => {
        logSpeech('timeout reached, skipping');
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
    logSpeech('skip() called, isReading:', this.isReading, 'speaking:', this.synth.speaking);

    // Clear timeout first
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // Save callback before cancel (cancel may or may not trigger onend/onerror)
    const callback = this.onEndCallback;
    this.onEndCallback = null;
    this.isReading = false;

    this.synth.cancel();
    logSpeech('skip: synth.cancel() done, calling callback');

    // Always call callback since synth.cancel() doesn't reliably fire events
    if (callback) {
      callback();
    }
  }

  stop(): void {
    logSpeech('stop() called');
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.onEndCallback = null;
    this.isReading = false;
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

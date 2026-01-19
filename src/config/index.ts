export type ReadingLanguageMode = 'browser' | 'autoAuthor' | 'autoNote' | 'specific';
export type DisplayLanguageMode = 'browser' | 'specific';
export type ReadingLimitMode = 'none' | 'limit';
export type NostrAuthMode = 'nip07' | 'pubkey';
export type ThemeMode = 'light' | 'dark' | 'system';

export interface Config {
  readingLanguageMode: ReadingLanguageMode;
  readingLanguageSpecific: string;
  displayLanguageMode: DisplayLanguageMode;
  displayLanguageSpecific: string;
  readingLimitMode: ReadingLimitMode;
  readingLimitSeconds: number;
  volume: number;
  // Sources
  sourceNostr: boolean;
  nostrAuthMode: NostrAuthMode;
  nostrPubkey: string;
  sourceBluesky: boolean;
  blueskyHandle: string;
  blueskyAppKey: string;
  theme: ThemeMode;
}

const CONFIG_KEY = 'yomi-config';

export const defaultConfig: Config = {
  readingLanguageMode: 'browser',
  readingLanguageSpecific: 'en',
  displayLanguageMode: 'browser',
  displayLanguageSpecific: 'en',
  readingLimitMode: 'none',
  readingLimitSeconds: 30,
  volume: 1.0,
  // Sources
  sourceNostr: true,
  nostrAuthMode: 'nip07',
  nostrPubkey: '',
  sourceBluesky: false,
  blueskyHandle: '',
  blueskyAppKey: '',
  theme: 'light',
};

export function loadConfig(): Config {
  try {
    const stored = localStorage.getItem(CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...defaultConfig, ...parsed };
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return { ...defaultConfig };
}

export function saveConfig(config: Config): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

// Common languages for combo box
export const languages = [
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文' },
  { code: 'ko', name: '한국어' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'ar', name: 'العربية' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'th', name: 'ไทย' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'uk', name: 'Українська' },
];

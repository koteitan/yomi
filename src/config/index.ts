import { loadJson, saveJson } from '../utils/storage';

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
  // Reading targets
  readEmoji: boolean;
  readCustomEmoji: boolean;
  readUrl: boolean;
  // Sources
  sourceNostr: boolean;
  nostrAuthMode: NostrAuthMode;
  nostrPubkey: string;
  sourceBluesky: boolean;
  blueskyHandle: string;
  blueskyAppKey: string;
  sourceMisskey: boolean;
  misskeyAccessToken: string;
  sourceDiscord: boolean;
  discordBotUrl: string;
  sourceTwitter: boolean;
  twitterClientId: string;
  twitterTimelineType: 'list' | 'home';
  twitterListId: string;
  theme: ThemeMode;
}

// localStorage: "yomi:config" (legacy unprefixed key kept for read fallback)
const CONFIG_NAME = 'config';
const LEGACY_CONFIG_KEY = 'yomi-config';

export const defaultConfig: Config = {
  readingLanguageMode: 'browser',
  readingLanguageSpecific: 'en',
  displayLanguageMode: 'browser',
  displayLanguageSpecific: 'en',
  readingLimitMode: 'none',
  readingLimitSeconds: 30,
  volume: 1.0,
  // Reading targets
  readEmoji: true,
  readCustomEmoji: true,
  readUrl: true,
  // Sources
  sourceNostr: true,
  nostrAuthMode: 'nip07',
  nostrPubkey: '',
  sourceBluesky: false,
  blueskyHandle: '',
  blueskyAppKey: '',
  sourceMisskey: false,
  misskeyAccessToken: '',
  sourceDiscord: false,
  discordBotUrl: 'ws://localhost:8765',
  sourceTwitter: false,
  twitterClientId: '',
  twitterTimelineType: 'list' as const,
  twitterListId: '',
  theme: 'light',
};

export function loadConfig(): Config {
  const parsed = loadJson<Partial<Config>>(CONFIG_NAME, LEGACY_CONFIG_KEY);
  if (parsed) {
    return { ...defaultConfig, ...parsed };
  }
  return { ...defaultConfig };
}

export function saveConfig(config: Config): void {
  saveJson(CONFIG_NAME, config);
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

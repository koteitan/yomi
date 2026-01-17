import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      start: 'Start',
      pause: 'Pause',
      resume: 'Resume',
      skip: 'Skip',
      pubkeyPlaceholder: 'Enter pubkey (hex or npub)',
      queueStatus: 'Queue: {{count}}',
      currentlyReading: 'Reading:',
      noNip07: 'NIP-07 extension not found. Please enter pubkey manually.',
      loading: 'Loading...',
      eose: 'EOSE!',
      nostrAddress: 'Nostr address',
      url: 'URL',
      postPlaceholder: 'type your message',
      mic: 'Mic',
      post: 'post',
      stop: 'Stop',
      statusRead: 'read: {{count}} events',
      statusQueue: 'in queue: {{count}} events',
    },
  },
  ja: {
    translation: {
      start: '開始',
      pause: '一時停止',
      resume: '再開',
      skip: 'スキップ',
      pubkeyPlaceholder: 'pubkeyを入力 (hex または npub)',
      queueStatus: 'キュー: {{count}}件',
      currentlyReading: '読み上げ中:',
      noNip07: 'NIP-07拡張機能が見つかりません。pubkeyを手動で入力してください。',
      loading: '読み込み中...',
      eose: 'イーオーエスイー',
      nostrAddress: 'ノスターアドレス',
      url: 'URL',
      postPlaceholder: 'メッセージを入力してください',
      mic: '録音',
      post: '投稿',
      stop: '停止',
      statusRead: '読了: {{count}}件',
      statusQueue: '待ち: {{count}}件',
    },
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;

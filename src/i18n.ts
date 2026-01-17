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
      eose: 'イオス！',
      nostrAddress: 'ノスターアドレス',
      url: 'URL',
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

import { franc } from 'franc-min';

// Map franc ISO 639-3 codes to BCP 47 codes for speech synthesis
const francToBcp47: Record<string, string> = {
  eng: 'en',
  jpn: 'ja',
  cmn: 'zh',
  zho: 'zh',
  kor: 'ko',
  spa: 'es',
  fra: 'fr',
  deu: 'de',
  ita: 'it',
  por: 'pt',
  rus: 'ru',
  arb: 'ar',
  ara: 'ar',
  hin: 'hi',
  tha: 'th',
  vie: 'vi',
  nld: 'nl',
  pol: 'pl',
  tur: 'tr',
  ukr: 'uk',
  ben: 'bn',
  ind: 'id',
  hun: 'hu',
  ces: 'cs',
  ell: 'el',
  ron: 'ro',
  swe: 'sv',
  bul: 'bg',
  hrv: 'hr',
  srp: 'sr',
  bos: 'bs',
  slk: 'sk',
  fin: 'fi',
  dan: 'da',
  nor: 'no',
  heb: 'he',
  pes: 'fa',
  tam: 'ta',
  tel: 'te',
  mar: 'mr',
  guj: 'gu',
  kan: 'kn',
  mal: 'ml',
  pan: 'pa',
  mya: 'my',
  tgl: 'tl',
  zlm: 'ms',
  swh: 'sw',
};

// Hiragana: U+3040-U+309F, Katakana: U+30A0-U+30FF
const japaneseKanaRegex = /[\u3040-\u309F\u30A0-\u30FF]/;

// Patterns to remove before language detection
const urlRegex = /https?:\/\/[^\s]+/gi;
const hashtagRegex = /#[^\s]+/gi;
const nostrRegex = /nostr:[^\s]+/gi;

function preprocessForDetection(text: string): string {
  return text
    .replace(urlRegex, '')
    .replace(hashtagRegex, '')
    .replace(nostrRegex, '')
    .trim();
}

export function detectLanguage(text: string): string {
  // Preprocess: remove URLs, hashtags, nostr addresses
  const cleanText = preprocessForDetection(text);

  const detected = franc(cleanText);
  let lang = francToBcp47[detected] || 'en';

  if (detected === 'und') {
    lang = 'en'; // fallback to English if undetermined
  }

  // Override: if original text contains hiragana or katakana, force Japanese
  if (japaneseKanaRegex.test(text)) {
    lang = 'ja';
  }

  return lang;
}

// Author language detection: weighted by character count
interface AuthorLanguageData {
  languages: Map<string, number>; // language code -> character count
}

const authorLanguages = new Map<string, AuthorLanguageData>();

export function updateAuthorLanguage(pubkey: string, text: string): void {
  const lang = detectLanguage(text);
  const charCount = text.length;

  let data = authorLanguages.get(pubkey);
  if (!data) {
    data = { languages: new Map() };
    authorLanguages.set(pubkey, data);
  }

  const current = data.languages.get(lang) || 0;
  data.languages.set(lang, current + charCount);
}

export function getAuthorLanguage(pubkey: string): string {
  const data = authorLanguages.get(pubkey);
  if (!data) {
    return 'en'; // fallback
  }

  let maxLang = 'en';
  let maxCount = 0;

  for (const [lang, count] of data.languages) {
    if (count > maxCount) {
      maxCount = count;
      maxLang = lang;
    }
  }

  return maxLang;
}

export function clearAuthorLanguages(): void {
  authorLanguages.clear();
}

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

export function detectLanguage(text: string): string {
  const detected = franc(text);
  if (detected === 'und') {
    return 'en'; // fallback to English if undetermined
  }
  return francToBcp47[detected] || 'en';
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

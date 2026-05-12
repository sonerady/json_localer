// App Store Connect + Google Play tarafından desteklenen birleşik yerelleştirme listesi.
// `code` UI'da gözüken locale tag'i; output dosya adı `outputCode || code`.
//
// Kurallar:
//   - rtl: true ise UI'da disabled — sağdan-sola scriptler şu an desteklenmiyor.
//   - DIRESS_EXISTING_BASE_LANGS içindeki base ile başlayan kodlar "Mevcut" olarak disabled.
//   - "en-US" kaynak (source) — her zaman disabled.

export interface AppStoreLocale {
  /** Locale tag (UI ve identifier olarak kullanılır) */
  code: string
  /**
   * Disk'e yazılırken / dosya indirilirken kullanılacak isim.
   * Region-suffixli kod (örn. "nl-NL") diress gibi short-code kullanan i18next
   * projelerine uymayabilir; bu yüzden bu alan varsa output dosyası bunun adıyla yazılır.
   * Belirtilmemişse `code` kullanılır.
   */
  outputCode?: string
  name: string
  nativeName: string
  language: string
  rtl?: boolean
}

export const APP_STORE_LOCALES: AppStoreLocale[] = [
  { code: 'af', name: 'Afrikaans', nativeName: 'Afrikaans', language: 'Afrikaans' },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ', language: 'Amharic' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', language: 'Arabic', rtl: true },
  { code: 'hy', name: 'Armenian', nativeName: 'Հայերեն', language: 'Armenian' },
  { code: 'az', name: 'Azerbaijani', nativeName: 'Azərbaycan', language: 'Azerbaijani' },
  { code: 'eu', name: 'Basque', nativeName: 'Euskara', language: 'Basque' },
  { code: 'be', name: 'Belarusian', nativeName: 'Беларуская', language: 'Belarusian' },
  { code: 'bn', name: 'Bangla', nativeName: 'বাংলা', language: 'Bangla (Bengali)' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български', language: 'Bulgarian' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català', language: 'Catalan' },
  { code: 'zh-Hans', name: 'Chinese (Simplified)', nativeName: '简体中文', language: 'Simplified Chinese' },
  { code: 'zh-Hant', name: 'Chinese (Traditional)', nativeName: '繁體中文', language: 'Traditional Chinese' },
  { code: 'zh-HK', name: 'Chinese (Hong Kong)', nativeName: '中文（香港）', language: 'Chinese (Hong Kong)' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski', language: 'Croatian' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština', language: 'Czech' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk', language: 'Danish' },
  { code: 'nl-NL', outputCode: 'nl', name: 'Dutch', nativeName: 'Nederlands', language: 'Dutch' },
  { code: 'en-AU', name: 'English (Australia)', nativeName: 'English (Australia)', language: 'Australian English' },
  { code: 'en-CA', name: 'English (Canada)', nativeName: 'English (Canada)', language: 'Canadian English' },
  { code: 'en-IN', name: 'English (India)', nativeName: 'English (India)', language: 'Indian English' },
  { code: 'en-SG', name: 'English (Singapore)', nativeName: 'English (Singapore)', language: 'Singapore English' },
  { code: 'en-ZA', name: 'English (South Africa)', nativeName: 'English (South Africa)', language: 'South African English' },
  { code: 'en-GB', name: 'English (UK)', nativeName: 'English (UK)', language: 'British English' },
  { code: 'en-US', name: 'English (US)', nativeName: 'English (US)', language: 'American English' },
  { code: 'et', name: 'Estonian', nativeName: 'Eesti', language: 'Estonian' },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino', language: 'Filipino' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi', language: 'Finnish' },
  { code: 'fr-FR', name: 'French', nativeName: 'Français', language: 'French' },
  { code: 'fr-CA', name: 'French (Canada)', nativeName: 'Français (Canada)', language: 'Canadian French' },
  { code: 'gl', name: 'Galician', nativeName: 'Galego', language: 'Galician' },
  { code: 'ka', name: 'Georgian', nativeName: 'ქართული', language: 'Georgian' },
  { code: 'de-DE', name: 'German', nativeName: 'Deutsch', language: 'German' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά', language: 'Greek' },
  { code: 'gu', name: 'Gujarati', nativeName: 'ગુજરાતી', language: 'Gujarati' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית', language: 'Hebrew', rtl: true },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', language: 'Hindi' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar', language: 'Hungarian' },
  { code: 'is', name: 'Icelandic', nativeName: 'Íslenska', language: 'Icelandic' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', language: 'Indonesian' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano', language: 'Italian' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語', language: 'Japanese' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ', language: 'Kannada' },
  { code: 'kk', name: 'Kazakh', nativeName: 'Қазақ тілі', language: 'Kazakh' },
  { code: 'km', name: 'Khmer', nativeName: 'ខ្មែរ', language: 'Khmer' },
  { code: 'ko', name: 'Korean', nativeName: '한국어', language: 'Korean' },
  { code: 'ky', name: 'Kyrgyz', nativeName: 'Кыргызча', language: 'Kyrgyz' },
  { code: 'lo', name: 'Lao', nativeName: 'ລາວ', language: 'Lao' },
  { code: 'lv', name: 'Latvian', nativeName: 'Latviešu', language: 'Latvian' },
  { code: 'lt', name: 'Lithuanian', nativeName: 'Lietuvių', language: 'Lithuanian' },
  { code: 'mk', name: 'Macedonian', nativeName: 'Македонски', language: 'Macedonian' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu', language: 'Malay' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം', language: 'Malayalam' },
  { code: 'mr', name: 'Marathi', nativeName: 'मराठी', language: 'Marathi' },
  { code: 'mn', name: 'Mongolian', nativeName: 'Монгол', language: 'Mongolian' },
  { code: 'ne', name: 'Nepali', nativeName: 'नेपाली', language: 'Nepali' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk', language: 'Norwegian' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی', language: 'Persian', rtl: true },
  { code: 'pl', name: 'Polish', nativeName: 'Polski', language: 'Polish' },
  { code: 'pt-BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)', language: 'Brazilian Portuguese' },
  { code: 'pt-PT', name: 'Portuguese (Portugal)', nativeName: 'Português (Portugal)', language: 'European Portuguese' },
  { code: 'pa', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ', language: 'Punjabi' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română', language: 'Romanian' },
  { code: 'rm', name: 'Romansh', nativeName: 'Rumantsch', language: 'Romansh' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский', language: 'Russian' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски', language: 'Serbian' },
  { code: 'si', name: 'Sinhala', nativeName: 'සිංහල', language: 'Sinhala' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina', language: 'Slovak' },
  { code: 'sl', name: 'Slovenian', nativeName: 'Slovenščina', language: 'Slovenian' },
  { code: 'es-ES', name: 'Spanish (Spain)', nativeName: 'Español', language: 'European Spanish' },
  { code: 'es-419', name: 'Spanish (Latin America)', nativeName: 'Español (Latinoamérica)', language: 'Latin American Spanish' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', language: 'Swahili' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska', language: 'Swedish' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', language: 'Tamil' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు', language: 'Telugu' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย', language: 'Thai' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe', language: 'Turkish' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська', language: 'Ukrainian' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو', language: 'Urdu', rtl: true },
  { code: 'uz', name: 'Uzbek', nativeName: 'Oʻzbekcha', language: 'Uzbek' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', language: 'Vietnamese' },
  { code: 'zu', name: 'Zulu', nativeName: 'isiZulu', language: 'Zulu' },
]

// Kaynak — her zaman disabled.
export const SOURCE_CODE = 'en-US'

// diress-project/client/locales/ klasöründe halihazırda dosya olan base lang'ler.
// Bu listedeki base ile başlayan tüm locale varyantları "Mevcut" olarak disabled olur
// (örn. 'de' içerirse 'de-DE' de disabled).
export const DIRESS_EXISTING_BASE_LANGS = new Set([
  'de',
  'en',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'tr',
  'zh',
])

export type DisabledReason = 'source' | 'rtl' | 'existing' | 'completed'

/**
 * @param completedOutputCodes Disk'te tamamlanmış (chunksDone >= chunksTotal)
 *   çevirilerin outputCode set'i. Varsa, listede olan locale'ler 'completed'
 *   reason'ı ile disabled olur.
 */
export function getDisabledReason(
  loc: AppStoreLocale,
  completedOutputCodes?: ReadonlySet<string>,
): DisabledReason | null {
  if (loc.code === SOURCE_CODE) return 'source'
  if (loc.rtl) return 'rtl'
  const base = loc.code.split('-')[0].toLowerCase()
  if (DIRESS_EXISTING_BASE_LANGS.has(base)) return 'existing'
  if (completedOutputCodes && completedOutputCodes.has(getOutputCode(loc))) {
    return 'completed'
  }
  return null
}

export function isSelectable(
  loc: AppStoreLocale,
  completedOutputCodes?: ReadonlySet<string>,
): boolean {
  return getDisabledReason(loc, completedOutputCodes) === null
}

export function getLocaleByCode(code: string): AppStoreLocale | undefined {
  return APP_STORE_LOCALES.find((l) => l.code === code)
}

/** Disk/output dosya adı için kullanılacak kod. outputCode varsa o, yoksa code. */
export function getOutputCode(loc: AppStoreLocale): string {
  return loc.outputCode || loc.code
}

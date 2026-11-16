const DIGIT_MAP: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

const PERSIAN_STOP_WORDS = new Set([
  'و',
  'در',
  'به',
  'از',
  'که',
  'را',
  'این',
  'آن',
  'با',
  'برای',
  'است',
  'هست',
  'نیست',
  'می',
  'یک',
  'یا',
  'تا',
  'بر',
  'هم',
  'اگر',
  'اما',
  'های',
  'ها',
  'شد',
  'شود',
  'کرد',
  'کند',
  'دارد',
  'باید',
  'چگونه',
  'چیست',
  'کدام',
  'کدوم',
  'چقدر',
  'چند',
  'چطور',
  'چه',
  'کی',
  'کجا',
  'آیا',
  'لطفا',
  'لطفاً',
  'سلام',
  'من',
  'ما',
  'شما',
  'خود',
  'تونم',
  'میتونم',
  'میتوانم',
  'میشود',
  'میشه',
  'کنم',
  'کنیم',
  'بگید',
  'بفرمایید',
  'صحبت',
  'the',
  'is',
  'are',
  'and',
  'or',
  'to',
  'of',
  'in',
  'for',
  'on',
  'with',
  'a',
  'an',
]);

/**
 * Normalizes Persian & Arabic character variants, Eastern digits, directional controls,
 * ZWNJ spacing, and punctuation for consistent lexical & FTS indexing.
 */
export function normalizePersianForSearch(input: string): string {
  if (!input) return '';

  let out = input
    .replace(/\u064A/g, 'ی') // Arabic Yeh -> Persian Yeh
    .replace(/\u0649/g, 'ی') // Alef Maksura -> Persian Yeh
    .replace(/\u06CC/g, 'ی') // Normalize Farsi Yeh
    .replace(/\u0643/g, 'ک') // Arabic Kaf -> Persian Kaf
    .replace(/\u06AA/g, 'ک') // Swash Kaf -> Persian Kaf
    .replace(/\u0629/g, 'ه') // Teh Marbuta -> Heh
    .replace(/\u06C0/g, 'ه') // Heh with Yeh above -> Heh
    .replace(/[\u0622\u0623\u0625\u0671]/g, 'ا') // Alef variants -> plain Alef
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // Arabic diacritics & tatweel
    .replace(/[\u200B\u200D\u200E\u200F\uFEFF]/g, '') // Zero-width/directional marks
    .replace(/\u200C/g, ' '); // ZWNJ -> space so compound & spaced tokens match identically

  out = out.replace(/[۰-۹٠-٩]/g, (ch) => DIGIT_MAP[ch] ?? ch);

  return out
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Preserves line structure, punctuation, and original digits while normalizing
 * Arabic Yeh/Kaf glyphs and line endings for readable storage and citations.
 */
export function normalizePersianPreservingStructure(input: string): string {
  if (!input) return '';
  const out = input
    .replace(/\r\n/g, '\n')
    .replace(/\u064A/g, 'ی')
    .replace(/\u0649/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/\u0629/g, 'ه')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[\u200E\u200F\uFEFF]/g, '');

  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export function tokenizePersianAndIdentifiers(input: string): string[] {
  const norm = normalizePersianForSearch(input);
  if (!norm) return [];

  // Keep identifier tokens (e.g. err-403, iso-27001, 1403/12/05, ir0011...) intact alongside words
  const identifiers = extractStructuredIdentifiers(norm);
  const wordTokens = norm
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !PERSIAN_STOP_WORDS.has(t));

  return Array.from(new Set([...identifiers, ...wordTokens]));
}

/**
 * Extracts regulation numbers, dates, IBAN/account IDs, hyphenated codes, and acronyms
 * so lexical retrieval indexes exact codes without fragmentation.
 */
export function extractStructuredIdentifiers(input: string): string[] {
  const norm = normalizePersianForSearch(input);
  if (!norm) return [];
  const matches = new Set<string>();

  // Hyphenated or slashed codes/dates (e.g. 1403/12/05, iso-27001, kb-102, err_403)
  for (const m of norm.matchAll(/\b[a-z0-9\u0600-\u06FF]+(?:[-_/][a-z0-9\u0600-\u06FF]+)+\b/gi)) {
    if (m[0].length >= 3) matches.add(m[0].toLowerCase());
  }

  // Standalone numeric IDs/regulation numbers >= 2 digits
  for (const m of norm.matchAll(/\b\d{2,}\b/g)) {
    matches.add(m[0]);
  }

  // Alphanumeric codes/IBANs (e.g. IR001122...)
  for (const m of norm.matchAll(/\b[a-z]{1,6}\d{2,}[a-z0-9]*\b/gi)) {
    matches.add(m[0].toLowerCase());
  }

  return Array.from(matches);
}

/**
 * Builds canonical searchable string fed to PostgreSQL `to_tsvector('simple', ...)`
 * containing normalized text + extracted identifier tokens.
 */
export function buildLexicalIndexString(
  text: string,
  extraContext?: string[]
): string {
  const base = normalizePersianForSearch(text);
  const extras = (extraContext || [])
    .map((e) => normalizePersianForSearch(e))
    .filter(Boolean);
  const identifiers = extractStructuredIdentifiers(`${base} ${extras.join(' ')}`);

  return [base, ...extras, ...identifiers].filter(Boolean).join(' ').trim();
}

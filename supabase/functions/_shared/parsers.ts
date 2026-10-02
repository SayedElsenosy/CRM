import { ALLOWED_AREAS, AREA_ALIASES } from './config.ts';

function normalizeArabic(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ARABIC_DIGITS: Record<string, string> = {
  '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9'
};

export function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩]/g, d => ARABIC_DIGITS[d] ?? d);
}

export function normalizeAreaName(text: string): string {
  return normalizeArabic(normalizeDigits(text));
}

export function parseAge(text: string): number | null {
  const normalized = normalizeDigits(text).trim();
  const m = normalized.match(/^(?:سني|عمري|عندي)?\s*(\d{1,2})\s*(?:سنة|سنه)?$/);
  if (!m) return null;
  const age = Number(m[1]);
  return Number.isFinite(age) ? age : null;
}

export function parseYesNo(text: string): boolean | null {
  const n = normalizeArabic(text);
  const yes = ['نعم','ايوه','ايوا','اه','ااه','تمام','موافق'].map(normalizeArabic);
  const no = ['لا','لاء','لأ','معنديش','ما عنديش'].map(normalizeArabic);
  if (no.includes(n)) return false;
  if (yes.includes(n)) return true;
  return null;
}

export function parseArea(text: string): string | null {
  // Exact selection only. Free text such as "مش عايز مدينة نصر" needs
  // interpretation or a clarification, never substring matching.
  const n = normalizeArabic(normalizeDigits(text));
  const aliasEntries = Object.entries(AREA_ALIASES)
    .map(([k, v]) => [normalizeArabic(normalizeDigits(k)), v] as const);

  for (const [alias, canonical] of aliasEntries) {
    if (n === alias) return canonical;
  }
  for (const area of ALLOWED_AREAS) {
    if (n === normalizeArabic(area)) return area;
  }
  return null;
}

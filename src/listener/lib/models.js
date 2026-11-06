// Model data crawler + parser tanggal. Tanpa zona waktu dianggap WIB (UTC+7); hasil selalu objek Date (UTC).

const ABBR = { WIB: '+0700', WITA: '+0800', WIT: '+0900' };
const HAS_TZ = /(Z|[+-]\d{2}:?\d{2}|\b(GMT|UTC|UT|[ECMP][SD]T)\b)\s*$/i;

export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  let s = String(value).trim().replace(/\b(WIB|WITA|WIT)\b/i, (m) => ABBR[m.toUpperCase()]);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}[ T]/.test(s)) s = s.replace(' ', 'T');
  let t;
  if (HAS_TZ.test(s)) t = Date.parse(s);
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) t = Date.parse(`${s}T00:00:00+07:00`);
  else if (/^\d{4}-\d{2}-\d{2}T/.test(s)) t = Date.parse(`${s}+07:00`);
  else t = Date.parse(`${s} +0700`);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Link artikel yang ditemukan di RSS/sitemap/homepage, sebelum isi lengkapnya diambil. */
export const candidate = (o) => ({ title: '', published: null, summary: '', author: '', tags: [], ...o });

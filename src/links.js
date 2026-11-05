// Mencari alamat ASLI artikel di situs penerbit. Modul ini hanya MEMBUNGKUS kode yang sudah ada tanpa mengubahnya:
//   1. resolveArticleUrl (src/resolver.js, tidak diubah): Bing News berdasarkan judul + domain, lalu pendekode Google dengan batas waktu
//   2. resolveGoogleUrl (src/gnews.js): pendekode Google lewat antrean satu per satu dengan penundaan bila kena 429
//   3. Cadangan untuk berita yang tautan awalnya sudah hilang: cari ulang judulnya di Google News RSS untuk mendapat tautan Google-nya, lalu dekode (langkah 2)
// resolveArticleUrl bisa mengembalikan tautan PENCARIAN Google sebagai pengganti; itu BUKAN alamat artikel, jadi di sini ditolak (isUsableArticleUrl).
import { cleanNewsTitle, isGoogleNewsUrl, resolveArticleUrl } from './resolver.js';
import { isGoogleArticle, resolveGoogleUrl } from './gnews.js';

export const isSearchUrl = (u) => /^https?:\/\/(www\.)?google\.com\/search/i.test(u || '');
// Alamat artikel yang boleh disimpan sebagai alamat penerbit: http(s), bukan tautan Google News, bukan pencarian Google/Bing
export const isUsableArticleUrl = (u) => /^https?:\/\//i.test(u || '') && !isGoogleNewsUrl(u) && !isSearchUrl(u) && !/^https?:\/\/(www\.)?bing\.com\//i.test(u);

const BS = String.fromCharCode(92);
const ITEM_RE = new RegExp('<item>([' + BS + 's' + BS + 'S]*?)</item>', 'g');
const field = (tag, xml) => (new RegExp('<' + tag + '>([' + BS + 's' + BS + 'S]*?)</' + tag + '>').exec(xml) || [])[1] || '';
const norm = (t) => cleanNewsTitle(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function cleanDomain(source_domain, source_name, url) {
  let dom = (source_domain || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  if (dom && dom !== 'google.com' && !dom.includes('google')) return dom;
  if (url) {
    const qMatch = url.match(/(?:q=|%20)([a-zA-Z0-9-]+\.[a-zA-Z]{2,})(?:&|$|\s)/);
    if (qMatch) return qMatch[1].toLowerCase();
  }
  if (source_name) {
    const s = source_name.toLowerCase().trim();
    if (s.includes('.')) {
      const parts = s.split(/\s+/);
      for (const p of parts) {
        if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}$/.test(p)) return p;
      }
    }
  }
  return '';
}

function wordSimilarity(t1, t2) {
  const w1 = new Set(t1.split(/\s+/).filter((w) => w.length > 2));
  const w2 = new Set(t2.split(/\s+/).filter((w) => w.length > 2));
  let match = 0;
  for (const w of w1) if (w2.has(w)) match++;
  return match / Math.max(w1.size, 1);
}

// Tautan Google News untuk sebuah judul (bila tautan awalnya tidak tersimpan lagi)
export async function googleLinkByTitle(title, domain) {
  const q = cleanNewsTitle(title);
  if (!q) return null;
  const res = await fetch('https://news.google.com/rss/search?q=' + encodeURIComponent('"' + q + '"') + '&hl=id&gl=ID&ceid=ID:id', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36' }, signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const xml = await res.text();
  const site = String(domain || '').replace(/^www[.]/, '').toLowerCase();
  const nTitle = norm(title);
  for (const m of xml.matchAll(ITEM_RE)) {
    const t = field('title', m[1]).replace(/&amp;/g, '&');
    const link = field('link', m[1]).trim();
    const src = ((/<source[^>]*url="([^"]+)"/.exec(m[1]) || [])[1] || '').toLowerCase();
    const nItem = norm(t);
    const titleMatches = nItem === nTitle || wordSimilarity(nItem, nTitle) >= 0.7;
    if (link && isGoogleArticle(link) && titleMatches && (!site || src.includes(site))) return link;
  }
  return null;
}

/** Alamat penerbit untuk satu berita, atau null bila tidak ketemu. masked = tautan Google News awalnya (bila masih ada). */
export async function findPublisherUrl({ masked = '', title, source_domain, source_name, signal } = {}) {
  const domain = cleanDomain(source_domain, source_name, masked);
  const maskedOk = isGoogleNewsUrl(masked) ? masked : '';
  let real = null;
  try { real = await resolveArticleUrl({ url: maskedOk, title, source_domain: domain, source_name }); } catch { /* lanjut ke cadangan */ }
  if (isUsableArticleUrl(real)) return real;
  let link = maskedOk;
  if (!link) { try { link = await googleLinkByTitle(title, domain); } catch { link = null; } }
  if (link) {
    const r = await resolveGoogleUrl(link, { signal }).catch(() => null);
    if (r?.ok && isUsableArticleUrl(r.url)) return r.url;
  }
  return null;
}

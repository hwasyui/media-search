// Semua fungsi SIMPAN ke MySQL untuk crawler, dipisah supaya bisa dipakai ulang dari mana saja.
// (Padanan src/db/save.js.) Idempoten: menyimpan data yang sama dua kali tidak menggandakan baris.
import crypto from 'node:crypto';
import { connect } from './db.js';
import { pyJson } from './util.js';

export const urlHash = (url) => crypto.createHash('sha1').update(url, 'utf8').digest();

/** ISO 8601 -> Date UTC (kolom DATETIME disimpan sebagai UTC). Tanpa zona dianggap UTC. */
export function toUtcNaive(iso) {
  if (!iso) return null;
  if (iso instanceof Date) return iso;
  const s = String(iso);
  const hasTz = /(Z|[+-]\d{2}:?\d{2})$/i.test(s);
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : hasTz ? s : `${s}Z`);
  return Number.isNaN(t) ? null : new Date(t);
}

const cut = (s, n) => Array.from(s || '').slice(0, n).join('');

/** true kalau baru tersimpan, false kalau URL sudah ada. */
export async function saveArticle(url, title, { published, author, domain, category, source, snippet, matched }) {
  const [r] = await connect().query(
    'INSERT IGNORE INTO crawler_articles (url_hash,url,title,published_at,author,domain,category,source,snippet,matched) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [urlHash(url), cut(url, 2048), cut(title, 1000), toUtcNaive(published), cut(author, 255) || null,
      cut(domain, 255) || null, cut(category, 40) || null, cut(source, 255) || null,
      snippet ?? null, pyJson([...matched], { ensureAscii: false })],
  );
  return r.affectedRows === 1;
}

export async function markSeen(url) {
  await connect().query('INSERT IGNORE INTO crawler_seen (url_hash) VALUES (?)', [urlHash(url)]);
}

export async function clearSeen() {
  await connect().query('TRUNCATE TABLE crawler_seen');
}

/** Cache hasil auto-discovery RSS/sitemap per domain. */
export async function saveDiscovery(domain, found) {
  await connect().query(
    'INSERT INTO crawler_discovery (domain,home,rss,sitemaps) VALUES (?,?,?,?)'
    + ' ON DUPLICATE KEY UPDATE home=VALUES(home), rss=VALUES(rss), sitemaps=VALUES(sitemaps)',
    [cut(domain, 255), found.home ?? null, pyJson(found.rss || []), pyJson(found.sitemaps || [])],
  );
}

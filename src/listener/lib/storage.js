// Index lokal di MySQL (schema media-search). Penyimpanan ada di dbSave.js; kelas ini menjaga antarmuka lama
// (Storage.save/isSeen/markSeen/search/stats) dan membaca dari tabel crawler_articles / crawler_seen.
import * as dbSave from './dbSave.js';
import { connect } from './db.js';

// Date -> ISO 8601 UTC gaya lama: 2026-11-05T10:00:00+00:00
const iso = (d) => (d ? new Date(d).toISOString().replace(/\.\d{3}Z$/, '+00:00') : null);
const parseJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

export class Storage {
  // `path` (--db) dipertahankan agar CLI lama tetap jalan, tetapi diabaikan: penyimpanan selalu MySQL.
  static async open(_path = '') {
    const s = new Storage();
    await connect().query('SELECT 1');          // gagal cepat bila kredensial/tabel belum siap
    return s;
  }

  // ── seen ──
  async isSeen(url) {
    const [rows] = await connect().query('SELECT 1 FROM crawler_seen WHERE url_hash = ?', [dbSave.urlHash(url)]);
    return rows.length > 0;
  }
  markSeen(url) { return dbSave.markSeen(url); }
  clearSeen() { return dbSave.clearSeen(); }

  // ── simpan artikel ──
  save(art, { domain, category, source, matched }) {
    return dbSave.saveArticle(art.url, art.title, {
      published: art.published ? art.published.toISOString() : null, author: art.author,
      domain, category, source, snippet: art.snippet, matched,
    });
  }

  // ── cari di index ──
  /** Terbaru dulu. SQL menyaring kategori dan tanggal; ekspresi boolean dievaluasi BooleanQuery sambil membaca
   *  baris satu per satu sampai `limit` terpenuhi. */
  async search(query = null, { category = null, since = null, limit = 50 } = {}) {
    let sql = 'SELECT url,title,published_at,author,domain,category,source,snippet,matched,fetched_at FROM crawler_articles WHERE 1=1';
    const params = [];
    if (category) { sql += ' AND category = ?'; params.push(category); }
    if (since) { sql += ' AND sort_at >= ?'; params.push(dbSave.toUtcNaive(since)); }
    sql += ' ORDER BY sort_at DESC';
    const out = [];
    const conn = await connect().getConnection();        // streaming, tidak memuat seluruh tabel
    let early = false;
    try {
      const stream = conn.connection.query(sql, params).stream();
      for await (const r of stream) {
        if (query && !query.matches(`${r.title || ''} ${r.snippet || ''}`)) continue;
        out.push({
          url: r.url, title: r.title, published: iso(r.published_at), author: r.author,
          domain: r.domain, category: r.category, source: r.source, snippet: r.snippet,
          matched: r.matched ? parseJson(r.matched) : [], fetched_at: iso(r.fetched_at),
        });
        if (out.length >= limit) { early = true; break; }
      }
    } finally {
      if (early) conn.destroy(); else conn.release();    // koneksi dengan sisa baris tak boleh dipakai ulang
    }
    return out;
  }

  // ── cache auto-discovery ──
  async getDiscovery(domain) {
    const [rows] = await connect().query('SELECT home,rss,sitemaps FROM crawler_discovery WHERE domain = ?', [domain]);
    const r = rows[0];
    return r ? { home: r.home, rss: parseJson(r.rss), sitemaps: parseJson(r.sitemaps) } : null;
  }
  saveDiscovery(domain, found) { return dbSave.saveDiscovery(domain, found); }

  // ── statistik ──
  async stats() {
    const db = connect();
    const [[{ n: total }]] = await db.query('SELECT COUNT(*) n FROM crawler_articles');
    const [cats] = await db.query("SELECT COALESCE(category,'unknown') k, COUNT(*) n FROM crawler_articles GROUP BY k");
    const [srcs] = await db.query("SELECT COALESCE(source,'unknown') k, COUNT(*) n FROM crawler_articles GROUP BY k ORDER BY n DESC LIMIT 15");
    return {
      total: Number(total),
      by_category: Object.fromEntries(cats.map((r) => [r.k, Number(r.n)])),
      top_sources: Object.fromEntries(srcs.map((r) => [r.k, Number(r.n)])),
    };
  }
}

// Baca berita/sinyal dari MySQL untuk portal: feed campuran (terbaru + paling relevan), filter, pencarian, hitungan per tab.
//
// Dua lapis data:
//   news_items   = MENTAH: semua hasil crawl (unik per URL, duplikat judul sudah dibuang saat simpan)
//   news_cleaned = VIEW atas news_items: hanya berita yang benar-benar terkait perusahaan/pemangku kepentingannya
//                  (related = 1) dan tidak dinilai AI sebagai tidak relevan. Selalu sinkron, tanpa salinan data.
// Website, hitungan, dan profil risiko membaca news_cleaned; opsi raw=true membaca news_items (data mentah).
import { db } from './db.js';

const srcTable = (raw) => (raw ? 'news_items' : 'news_cleaned');

// "Perlu perhatian": AI menilai dampaknya buruk, atau ada tag risiko tingkat 3 ke atas (keduanya dinilai AI dari isi artikel).
const RISK_SQL = "(n.impact = 'buruk' OR n.risk_level >= 3)";
// Sudah dinilai AI dengan format baru (ada peran perusahaan). Hasil AI lama / belum dinilai = "pending": tidak punya dampak & tag risiko yang bisa dipercaya.
const ASSESSED_SQL = "(n.ai_status = 'ok' AND n.company_role IS NOT NULL)";

// Tab portal -> kondisi SQL. Semua berbasis kolom non-AI/AI yang sudah diindeks (lihat db/schema.sql).
const FILTERS = {
  all: '1=1',
  official: "n.credibility_tier = 'official'",
  rumor: "n.category = 'rumor'",                                           // tidak lagi jadi tab di UI; dipertahankan untuk kompatibilitas API
  positive: "n.impact = 'baik'",
  risk: RISK_SQL,                                                         // perlu perhatian: dampak buruk (AI) ATAU ada temuan risiko tingkat >= 3
  video: "n.source_key = 'youtube'",
  public: "n.content_kind = 'persepsi_publik'",
};
export const FILTER_KEYS = Object.keys(FILTERS);

// Skor campuran: relevansi + kredibilitas + kebaruan (turun ~1 poin per 6 jam, maksimal 50).
// COALESCE di semua suku: berita yang belum dinilai AI punya kolom NULL; tanpa COALESCE seluruh skornya jadi NULL dan semuanya terurut asal-asalan.
const MIX_SCORE = `(
  COALESCE(n.relevant = 1, 0) * 40 + COALESCE(n.credibility_score, 50) * 0.4
  + GREATEST(0, 50 - TIMESTAMPDIFF(HOUR, n.sort_at, UTC_TIMESTAMP()) / 6)
  + COALESCE(n.impact = 'buruk', 0) * 8 + COALESCE(n.risk_level, 0) * 3
  - COALESCE(n.content_kind = 'persepsi_publik', 0) * 20
)`;

const SORTS = {
  mix: `${MIX_SCORE} DESC, n.sort_at DESC`,                              // campuran: relevan + kredibel + baru
  latest: 'n.sort_at DESC',                                                // terbaru
  oldest: 'n.sort_at ASC',                                                 // terlama
  risk: 'n.risk_level DESC, n.sort_at DESC',                               // tingkat risiko tertinggi
  credibility: 'COALESCE(n.credibility_score, 0) DESC, n.sort_at DESC',    // sumber paling kredibel
  confidence: 'COALESCE(n.confidence, 0) DESC, n.sort_at DESC',            // keyakinan AI tertinggi
  seen: 'n.seen_count DESC, COALESCE(n.last_seen_at, n.sort_at) DESC',     // paling sering muncul di crawl
  relevant: 'n.relevant DESC, n.confidence DESC, n.sort_at DESC',
};

const COLS = `n.id, n.company_id, c.name AS company_name, c.ticker AS company_ticker, n.url, n.title, n.snippet, n.source_name, n.source_key,
  n.sort_at AS published_at, n.credibility_tier, n.credibility_score, n.impact, n.impact_reason, n.status_line, n.ai_status,
  n.relevant, n.category, n.sentiment, n.confidence, n.reason, n.risk_signals, n.topic, n.image_url, n.source_domain,
  n.related, n.related_via, n.risk_level, n.risk_tags, n.article_url, n.image_checked, n.platform, n.content_kind, n.ai_summary, n.company_role`;

const PLATFORM_KEYS = ['berita', 'blog', 'sosmed', 'video', 'resmi'];
const KIND_KEYS = ['resmi', 'berita', 'persepsi_publik', 'konsumen'];
const TIER_KEYS = ['official', 'mainstream', 'social_forum'];
const IMPACT_KEYS = ['baik', 'buruk', 'netral'];
const SENT_KEYS = ['positif', 'netral', 'negatif'];
const CAT_KEYS = ['fakta', 'opini', 'rumor'];
const RISKCAT_KEYS = ['hukum', 'keuangan', 'integritas', 'kepemilikan', 'operasional', 'regulasi', 'reputasi'];
const AI_KEYS = ['ok', 'failed', 'skipped'];      // 'assessed' / 'pending' ditangani terpisah di where()
const pick = (v, keys) => (keys.includes(v) ? v : null);

// Semua filter yang bisa dipakai (semua opsional, bisa dikombinasikan):
//   company, q (cari judul/cuplikan/sumber/perusahaan), days (0 = semua waktu), filter (tab), platform, kind, tier, impact, category, sentiment,
//   riskMin (0-5), riskCat, related ('perusahaan' | 'stakeholder' | 'tidak'), ai, source (domain sumber)
// skipTab=true dipakai untuk menghitung badge tab (semua filter lain tetap berlaku).
function where(f = {}, { skipTab = false } = {}) {
  const parts = [skipTab ? '1=1' : (FILTERS[f.filter] || FILTERS.all)];
  const params = [];
  const eq = (col, val, keys) => { const v = pick(val, keys); if (v) { parts.push(col + ' = ?'); params.push(v); } };
  if (f.company) { parts.push('n.company_id = ?'); params.push(f.company); }
  if (f.days && Number(f.days) > 0) { parts.push('n.sort_at >= UTC_TIMESTAMP() - INTERVAL ? DAY'); params.push(Math.min(3650, Number(f.days))); }
  eq('n.platform', f.platform, PLATFORM_KEYS);
  eq('n.content_kind', f.kind, KIND_KEYS);
  eq('n.credibility_tier', f.tier, TIER_KEYS);
  eq('n.impact', f.impact, IMPACT_KEYS);
  eq('n.sentiment', f.sentiment, SENT_KEYS);
  eq('n.category', f.category, CAT_KEYS);
  if (f.ai === 'assessed') parts.push(ASSESSED_SQL);
  else if (f.ai === 'pending') parts.push('NOT ' + ASSESSED_SQL);
  else eq('n.ai_status', f.ai, AI_KEYS);
  if (Number(f.riskMin) > 0) { parts.push('n.risk_level >= ?'); params.push(Math.min(5, Number(f.riskMin))); }
  if (pick(f.riskCat, RISKCAT_KEYS)) { parts.push("JSON_SEARCH(n.risk_tags, 'one', ?, NULL, '$[*].cat') IS NOT NULL"); params.push(f.riskCat); }
  if (f.related === 'perusahaan') parts.push("n.related_via = 'perusahaan'");
  else if (f.related === 'stakeholder') parts.push("n.related_via LIKE 'stakeholder:%'");
  else if (f.related === 'tidak') parts.push('n.related = 0');
  if (f.source && /^[\w.-]{2,120}$/.test(f.source)) { parts.push('n.source_domain = ?'); params.push(f.source); }
  if (f.q && f.q.trim()) {
    // LIKE (bukan FULLTEXT) supaya potongan kata dan kata pendek tetap ketemu
    parts.push('(n.title LIKE ? OR n.snippet LIKE ? OR n.source_name LIKE ? OR c.name LIKE ?)');
    const like = `%${f.q.trim().replace(/[%_]/g, '\\$&')}%`;
    params.push(like, like, like, like);
  }
  return { sql: parts.join(' AND '), params };
}

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const shape = (r) => ({ ...r, risk_signals: parse(r.risk_signals), risk_tags: parse(r.risk_tags) });

export async function listNews({ sort = 'mix', limit = 30, offset = 0, raw = false, ...f } = {}) {
  const w = where({ days: 30, ...f });
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  const off = Math.max(0, Number(offset) || 0);
  const [rows] = await db().query(
    `SELECT ${COLS} FROM ${srcTable(raw)} n JOIN companies c ON c.id = n.company_id WHERE ${w.sql} ORDER BY ${SORTS[sort] || SORTS.mix}, n.id DESC LIMIT ? OFFSET ?`,
    [...w.params, lim, off],
  );
  return rows.map(shape);
}

// Total hasil untuk semua filter yang aktif (untuk "Menampilkan X dari Y").
export async function newsTotal({ raw = false, ...f } = {}) {
  const w = where({ days: 30, ...f });
  const [[r]] = await db().query(`SELECT COUNT(*) n FROM ${srcTable(raw)} n JOIN companies c ON c.id = n.company_id WHERE ${w.sql}`, w.params);
  return Number(r.n);
}

// Hitungan untuk badge tab: semua filter lain tetap berlaku, tab-nya sendiri diabaikan.
export async function newsCounts({ raw = false, ...f } = {}) {
  const w = where({ days: 30, ...f }, { skipTab: true });
  const [[r]] = await db().query(
    `SELECT COUNT(*) AS \`all\`,
       SUM(n.credibility_tier = 'official') AS official, SUM(n.category = 'rumor') AS rumor,
       SUM(n.impact = 'baik') AS positive, SUM(${RISK_SQL}) AS risk, SUM(n.source_key = 'youtube') AS video,
       SUM(n.content_kind = 'persepsi_publik') AS public
     FROM ${srcTable(raw)} n JOIN companies c ON c.id = n.company_id WHERE ${w.sql}`,
    w.params,
  );
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v) || 0]));
}

// Pilihan untuk dropdown beserta jumlahnya (mengikuti perusahaan, rentang waktu, dan mode mentah/cleaned).
export async function newsFacets({ company, days = 30, raw = false } = {}) {
  const w = where({ company, days });
  const base = `FROM ${srcTable(raw)} n JOIN companies c ON c.id = n.company_id WHERE ${w.sql}`;
  const grp = async (col, extra = '') => {
    const [rows] = await db().query(`SELECT ${col} v, COUNT(*) n ${base} ${extra} GROUP BY ${col} ORDER BY n DESC`, w.params);
    return Object.fromEntries(rows.filter((r) => r.v != null && r.v !== '').map((r) => [r.v, Number(r.n)]));
  };
  const [platform, kind, tier, impact, sentiment, category, ai, riskLevel] = await Promise.all([
    grp('n.platform'), grp('n.content_kind'), grp('n.credibility_tier'), grp('n.impact'), grp('n.sentiment'), grp('n.category'), Promise.resolve({}), grp('n.risk_level'),
  ]);
  const [src] = await db().query(`SELECT n.source_domain v, COUNT(*) n ${base} AND n.source_domain IS NOT NULL GROUP BY n.source_domain ORDER BY n DESC LIMIT 40`, w.params);
  // Jumlah per kategori risiko: satu query dengan SUM per kategori (tanpa JSON_TABLE agar tahan terhadap risk_tags kosong)
  const [[rc]] = await db().query(
    `SELECT ${RISKCAT_KEYS.map((k) => `SUM(JSON_SEARCH(n.risk_tags, 'one', '${k}', NULL, '$[*].cat') IS NOT NULL) AS ${k}`).join(', ')} ${base}`,
    w.params,
  );
  const [[rel]] = await db().query(`SELECT SUM(n.related_via = 'perusahaan') perusahaan, SUM(n.related_via LIKE 'stakeholder:%') stakeholder, SUM(n.related = 0) tidak ${base}`, w.params);
  const [[as]] = await db().query(`SELECT SUM(${ASSESSED_SQL}) assessed, SUM(NOT ${ASSESSED_SQL}) pending ${base}`, w.params);
  const aiStat = Object.fromEntries(Object.entries(as).map(([k, v]) => [k, Number(v) || 0]));
  return {
    platform, kind, tier, impact, sentiment, category, ai: aiStat, riskLevel,
    source: Object.fromEntries(src.map((r) => [r.v, Number(r.n)])),
    riskCat: Object.fromEntries(Object.entries(rc).map(([k, v]) => [k, Number(v) || 0]).filter(([, v]) => v > 0)),
    related: Object.fromEntries(Object.entries(rel).map(([k, v]) => [k, Number(v) || 0])),
  };
}

// Jumlah per platform untuk dropdown (kompatibel dengan pemanggil lama).
export async function platformCounts({ company, q, days = 30, raw = false } = {}) {
  const w = where({ company, q, days });
  const [rows] = await db().query(
    `SELECT n.platform p, COUNT(*) n FROM ${srcTable(raw)} n JOIN companies c ON c.id = n.company_id WHERE ${w.sql} GROUP BY n.platform`,
    w.params,
  );
  return Object.fromEntries(rows.map((r) => [r.p, Number(r.n)]));
}

// Ringkasan sinyal per perusahaan (kartu "Portofolio" / panel kanan) dari data cleaned.
export async function companyNewsStats(days = 30) {
  const [rows] = await db().query(
    `SELECT n.company_id, COUNT(*) AS total, SUM(n.credibility_tier = 'official') AS official, SUM(n.category = 'rumor') AS rumor,
       SUM(n.impact = 'baik') AS positive, SUM(${RISK_SQL}) AS risk, MAX(n.sort_at) AS latest
     FROM news_cleaned n WHERE n.sort_at >= UTC_TIMESTAMP() - INTERVAL ? DAY GROUP BY n.company_id`,
    [days],
  );
  return Object.fromEntries(rows.map((r) => [r.company_id, {
    total: Number(r.total), official: Number(r.official), rumor: Number(r.rumor),
    positive: Number(r.positive), risk: Number(r.risk), latest: r.latest,
  }]));
}

// ─── Kelengkapan sinyal ────────────────────────────────
// Berita dianggap LENGKAP bila AI berstatus ok dan semua kolom sinyal di bawah terisi. Berita lengkap tidak dikirim ulang ke AI.
// Kalau nanti ada sinyal baru: tambah kolomnya di skema, lalu masukkan namanya ke daftar ini; berita lama yang belum punya
// sinyal itu otomatis dianggap kurang lengkap dan diproses ulang (tanpa menyentuh yang sudah lengkap untuk sinyal lain).
export const SIGNAL_COLS = ['relevant', 'category', 'sentiment', 'confidence', 'reason', 'topic', 'impact', 'status_line', 'credibility_tier', 'ai_summary', 'company_role'];
export const INCOMPLETE_SQL = "(ai_status <> 'ok' OR " + SIGNAL_COLS.map((c) => c + ' IS NULL').join(' OR ') + ')';

// Pisahkan item hasil clean: yang masih perlu AI (todo) dan yang sudah lengkap di DB (complete). Memakai tabel mentah.
export async function splitComplete(companyId, items) {
  if (!companyId || !items.length) return { todo: items, complete: [] };
  const { createHash } = await import('node:crypto');
  const hex = (u) => createHash('sha1').update(u).digest('hex').toUpperCase();
  const done = new Set();
  for (let i = 0; i < items.length; i += 500) {
    const hashes = items.slice(i, i + 500).map((it) => Buffer.from(hex(it.url), 'hex'));
    const [rows] = await db().query('SELECT HEX(url_hash) h FROM news_items WHERE company_id = ? AND url_hash IN (?) AND NOT ' + INCOMPLETE_SQL, [companyId, hashes]);
    rows.forEach((r) => done.add(r.h));
  }
  return { todo: items.filter((it) => !done.has(hex(it.url))), complete: items.filter((it) => done.has(hex(it.url))) };
}

// Berita cleaned 90 hari terakhir (untuk profil risiko); risk_tags sudah dihitung saat disimpan.
export async function listRiskNews(companyId, days = 90) {
  const [rows] = await db().query(
    `SELECT n.id, n.title, n.url, n.source_name, n.sort_at AS published_at, n.credibility_tier, n.category, n.sentiment, n.ai_status, n.risk_tags, n.risk_level, n.related_via, n.company_role
       FROM news_cleaned n WHERE n.company_id = ? AND n.sort_at >= UTC_TIMESTAMP() - INTERVAL ? DAY
       ORDER BY n.risk_level DESC, n.sort_at DESC LIMIT 400`,
    [companyId, days],
  );
  return rows;
}

// Detail lengkap satu berita (data mentah) untuk modal: semua sinyal, jejak penemuan, dan alasan keterkaitan.
export async function getNewsDetail(id) {
  const [[r]] = await db().query(
    `SELECT n.*, c.name AS company_name, c.ticker AS company_ticker, c.type AS company_type
       FROM news_items n JOIN companies c ON c.id = n.company_id WHERE n.id = ?`,
    [id],
  );
  if (!r) return null;
  const j = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
  const { url_hash, title_hash, ...rest } = r;
  const via = j(r.found_via);
  // Alat pengambil: dari jejak penemuan bila ada; berita lama diperkirakan dari bentuk tautan (Google News mengalihkan lewat news.google.com,
  // YouTube dari youtube.com, sisanya umumnya tautan langsung dari Bing News).
  let adapters = Array.isArray(via) ? [...new Set(via.map((v) => v.src).filter(Boolean))] : [];
  let adaptersInferred = false;
  if (!adapters.length) {
    let host = '';
    try { host = new URL(r.url).hostname; } catch { /* host kosong */ }
    adapters = [/(^|\.)news\.google\.com$/.test(host) ? 'google_news' : /(^|\.)(youtube\.com|youtu\.be)$/.test(host) ? 'youtube' : 'bing_news'];
    adaptersInferred = true;
  }
  return { ...rest, risk_signals: j(r.risk_signals), risk_tags: j(r.risk_tags), found_via: via, adapters, adapters_inferred: adaptersInferred, published_at: r.sort_at };
}

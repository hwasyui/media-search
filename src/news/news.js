// Baca berita/sinyal dari MySQL untuk portal: feed campuran (terbaru + paling relevan), filter, pencarian, hitungan per tab.
//
// Dua lapis data:
//   news_items   = MENTAH: semua hasil crawl (unik per URL, duplikat judul sudah dibuang saat simpan)
//   news_cleaned = VIEW atas news_items: hanya berita yang benar-benar terkait perusahaan/pemangku kepentingannya
//                  (related = 1) dan tidak dinilai AI sebagai tidak relevan. Selalu sinkron, tanpa salinan data.
// Tiga lapis: news_items (mentah) -> news_cleaned (alamat penerbit valid) -> news_relevant (relevan menurut AI). Website, hitungan, dan profil risiko membaca news_relevant; opsi raw=true membaca news_items (data mentah).
import { db } from '../db/db.js';

const srcTable = (raw) => (raw === 'cleaned' ? 'news_cleaned' : raw ? 'news_items' : 'news_relevant');      // lapis: mentah = news_items, 'cleaned' = news_cleaned, default = news_relevant

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

// Penalti suara publik/tulisan pengguna (-60) membuatnya tidak pernah mengalahkan berita redaksi.
// Skor campuran: relevansi + kredibilitas + kebaruan (turun ~1 poin per 6 jam, maksimal 50).
// COALESCE di semua suku: berita yang belum dinilai AI punya kolom NULL; tanpa COALESCE seluruh skornya jadi NULL dan semuanya terurut asal-asalan.
const MIX_SCORE = `(
  COALESCE(n.relevant = 1, 0) * 40 + COALESCE(n.credibility_score, 50) * 0.4
  + GREATEST(0, 50 - TIMESTAMPDIFF(HOUR, n.sort_at, UTC_TIMESTAMP()) / 6)
  + COALESCE(n.impact = 'buruk', 0) * 8 + COALESCE(n.risk_level, 0) * 3
  - COALESCE(n.content_kind = 'persepsi_publik', 0) * 60
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

const COLS = `n.id, n.company_id, c.name AS company_name, c.ticker AS company_ticker, COALESCE(n.article_url, n.found_url) AS url, n.title, n.snippet, n.source_name, n.source_key,
  n.sort_at AS published_at, n.credibility_tier, n.credibility_score, n.impact, n.impact_reason, n.ai_status,
  n.relevant, n.category, n.sentiment, n.confidence, n.reason, n.risk_signals, n.topic, n.image_url, n.source_domain,
  n.related, n.related_via, n.risk_level, n.risk_tags, n.article_url, n.image_checked, n.platform, n.content_kind, n.ai_summary, n.company_role, (SELECT COUNT(*) FROM news_also a WHERE a.news_id = n.id) AS also_n`;
// Perusahaan LAIN yang punya berita dengan alamat penerbit sama (satu artikel bisa relevan untuk beberapa perusahaan), beserta dampak dan peran menurut AI untuk masing-masing. Untuk label di kartu.
// Satu CERITA: alamat penerbit yang sama, atau judul persis sama (title_hash) pada perusahaan lain dalam 72 jam (cerita yang sama dari media berbeda punya alamat berbeda).
const SAME_STORY = (a, b) => `(${b}.article_url = ${a}.article_url OR (${b}.title_hash = ${a}.title_hash AND ${b}.company_id <> ${a}.company_id AND ABS(TIMESTAMPDIFF(HOUR, ${b}.sort_at, ${a}.sort_at)) <= 72))`;
const alsoCos = (table) => `(SELECT JSON_ARRAYAGG(JSON_OBJECT('nid', m.id, 'id', c3.id, 'l', COALESCE(c3.ticker, c3.name), 'i', m.impact, 'r', m.company_role)) FROM ${table} m JOIN companies c3 ON c3.id = m.company_id WHERE ${SAME_STORY('n', 'm')} AND m.company_id <> n.company_id) AS also_cos`;

const PLATFORM_KEYS = ['berita', 'blog', 'sosmed', 'video', 'resmi'];
const KIND_KEYS = ['resmi', 'berita', 'persepsi_publik', 'konsumen'];
const TIER_KEYS = ['official', 'mainstream', 'corporate', 'aggregator', 'social_forum'];
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
// Wakil kartu gabungan: perusahaan yang paling berperan dalam artikel (subjek > ikut terlibat > disebut sekilas > pihak lain > belum dinilai), lalu id terkecil.
const ROLE_RANK = (a) => `CASE ${a}.company_role WHEN 'subjek' THEN 0 WHEN 'pihak_terlibat' THEN 1 WHEN 'disebut_sekilas' THEN 2 WHEN 'pihak_lain' THEN 3 ELSE 4 END`;
const BETTER = (m, n) => `(${ROLE_RANK(m)} < ${ROLE_RANK(n)} OR (${ROLE_RANK(m)} = ${ROLE_RANK(n)} AND ${m}.id < ${n}.id))`;
function where(f = {}, { skipTab = false, table = null } = {}) {
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
  // Semua perusahaan (tanpa memilih satu perusahaan): satu artikel yang sama (alamat penerbit sama) tampil SEKALI sebagai satu kartu; wakilnya baris dengan id terkecil
  // yang lolos filter yang sama (didahulukan perusahaan yang paling berperan), dan perusahaan lain ditampilkan di kartu itu. Di halaman satu perusahaan tidak ada penggabungan.
  if (table && !f.company) {
    const inner = parts.join(' AND ').replace(/\bn\./g, 'm.').replace(/\bc\./g, 'c2.');
    const innerParams = [...params];
    // Dua NOT EXISTS terpisah (alamat sama / judul sama) supaya masing-masing memakai satu indeks; satu NOT EXISTS dengan OR memaksa pemindaian penuh (puluhan detik).
    const from = ' FROM ' + table + ' m JOIN companies c2 ON c2.id = m.company_id WHERE ' + inner;
    parts.push('NOT EXISTS (SELECT 1' + from + ' AND m.article_url = n.article_url AND ' + BETTER('m', 'n') + ')');
    params.push(...innerParams);
    parts.push('NOT EXISTS (SELECT 1' + from + ' AND m.title_hash = n.title_hash AND m.company_id <> n.company_id AND ABS(TIMESTAMPDIFF(HOUR, m.sort_at, n.sort_at)) <= 72 AND ' + BETTER('m', 'n') + ')');
    params.push(...innerParams);
  }
  return { sql: parts.join(' AND '), params };
}

const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const shape = (r) => ({ ...r, risk_signals: parse(r.risk_signals), risk_tags: parse(r.risk_tags), also_cos: parse(r.also_cos) || [] });

export async function listNews({ sort = 'mix', limit = 30, offset = 0, raw = false, ...f } = {}) {
  const table = srcTable(raw);
  const w = where({ days: 30, ...f }, { table });
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  const off = Math.max(0, Number(offset) || 0);
  const [rows] = await db().query(
    `SELECT ${COLS}, ${alsoCos(table)} FROM ${table} n JOIN companies c ON c.id = n.company_id WHERE ${w.sql} ORDER BY ${SORTS[sort] || SORTS.mix}, n.id DESC LIMIT ? OFFSET ?`,
    [...w.params, lim, off],
  );
  return rows.map(shape);
}

// Total hasil untuk semua filter yang aktif (untuk "Menampilkan X dari Y").
export async function newsTotal({ raw = false, ...f } = {}) {
  const w = where({ days: 30, ...f }, { table: srcTable(raw) });
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
  const w = where({ company, days }, { table: srcTable(raw) });
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
  const w = where({ company, q, days }, { table: srcTable(raw) });
  const [rows] = await db().query(
    `SELECT n.platform p, COUNT(*) n FROM ${srcTable(raw)} n JOIN companies c ON c.id = n.company_id WHERE ${w.sql} GROUP BY n.platform`,
    w.params,
  );
  return Object.fromEntries(rows.map((r) => [r.p, Number(r.n)]));
}

// Jumlah berita di tiap lapis data (seluruh waktu), untuk pemilih Lapis di header
export async function layerCounts() {
  const [[r]] = await db().query('SELECT COUNT(*) mentah, COALESCE(SUM(stage >= 1), 0) cleaned, COALESCE(SUM(stage = 2), 0) relevan FROM news_items');
  // cerita = berita yang sama (lihat SAME_STORY) untuk beberapa perusahaan dihitung sekali, sama dengan penggabungan kartu di Beranda; baris = per perusahaan
  const stories = async (cond) => {
    const inner = cond.replace(/n./g, 'm.');
    const [[x]] = await db().query(`SELECT COUNT(*) n FROM news_items n WHERE ${cond}
      AND NOT EXISTS (SELECT 1 FROM news_items m WHERE ${inner} AND m.article_url = n.article_url AND ${BETTER('m', 'n')})
      AND NOT EXISTS (SELECT 1 FROM news_items m WHERE ${inner} AND m.title_hash = n.title_hash AND m.company_id <> n.company_id AND ABS(TIMESTAMPDIFF(HOUR, m.sort_at, n.sort_at)) <= 72 AND ${BETTER('m', 'n')})`);
    return Number(x.n);
  };
  const [sm, sc, sr] = await Promise.all([stories('1 = 1'), stories('n.stage >= 1'), stories('n.stage = 2')]);
  return { mentah: Number(r.mentah), cleaned: Number(r.cleaned), relevan: Number(r.relevan), cerita: { mentah: sm, cleaned: sc, relevan: sr } };
}

// Ringkasan sinyal per perusahaan (kartu "Portofolio" / panel kanan) dari data cleaned.
export async function companyNewsStats(days = 30, raw = false) {
  const [rows] = await db().query(
    `SELECT n.company_id, COUNT(*) AS total, SUM(n.credibility_tier = 'official') AS official, SUM(n.category = 'rumor') AS rumor,
       SUM(n.impact = 'baik') AS positive, SUM(${RISK_SQL}) AS risk, MAX(n.sort_at) AS latest
     FROM ${srcTable(raw)} n WHERE n.sort_at >= UTC_TIMESTAMP() - INTERVAL ? DAY GROUP BY n.company_id`,
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
export const SIGNAL_COLS = ['relevant', 'category', 'sentiment', 'confidence', 'reason', 'topic', 'impact', 'credibility_tier', 'ai_summary', 'company_role'];
export const INCOMPLETE_SQL = "(ai_status <> 'ok' OR " + SIGNAL_COLS.map((c) => c + ' IS NULL').join(' OR ') + ')';

// Pisahkan item hasil clean: yang masih perlu AI (todo) dan yang sudah lengkap di DB (complete). Memakai tabel mentah.
export async function splitComplete(companyId, items) {
  if (!companyId || !items.length) return { todo: items, complete: [] };
  const { createHash } = await import('node:crypto');
  const hex = (u) => createHash('sha1').update(u).digest('hex').toUpperCase();
  const done = new Set();
  for (let i = 0; i < items.length; i += 500) {
    const hashes = items.slice(i, i + 500).map((it) => Buffer.from(hex(it.canonical || it.originalUrl || it.url), 'hex'));
    const [rows] = await db().query('SELECT HEX(url_hash) h FROM news_items WHERE company_id = ? AND url_hash IN (?) AND NOT ' + INCOMPLETE_SQL, [companyId, hashes]);
    rows.forEach((r) => done.add(r.h));
  }
  return { todo: items.filter((it) => !done.has(hex(it.canonical || it.originalUrl || it.url))), complete: items.filter((it) => done.has(hex(it.canonical || it.originalUrl || it.url))) };
}

// Berita cleaned 90 hari terakhir (untuk profil risiko); risk_tags sudah dihitung saat disimpan.
export async function listRiskNews(companyId, days = 90) {
  const [rows] = await db().query(
    `SELECT n.id, n.title, COALESCE(n.article_url, n.found_url) AS url, n.source_name, n.sort_at AS published_at, n.credibility_tier, n.category, n.sentiment, n.ai_status, n.risk_tags, n.risk_level, n.related_via, n.company_role
       FROM news_relevant n WHERE n.company_id = ? AND n.sort_at >= UTC_TIMESTAMP() - INTERVAL ? DAY
       ORDER BY n.risk_level DESC, n.sort_at DESC LIMIT 400`,
    [companyId, days],
  );
  return rows;
}

// Detail lengkap satu berita (data mentah) untuk modal: semua sinyal, jejak penemuan, dan alasan keterkaitan.
// Isi artikel yang tampak TERPOTONG (paywall/pratinjau penerbit atau ekstraksi terhenti): teks cukup panjang tapi tidak berakhir dengan tanda akhir kalimat.
// Hanya untuk berita/sumber resmi/blog; caption video dan sosmed memang tidak berbentuk kalimat utuh. Heuristik, bukan kepastian.
// Baris penutup bawaan situs (tanggal terbit, editor, ajakan membaca/mengikuti) bukan bagian kalimat artikel, jadi tidak ikut dinilai.
const FOOTER_LINE = /^(diterbitkan|dipublikasikan|dipublikasi|published|updated|diperbarui|editor|penulis|reporter|sumber|source|foto|baca juga|baca selengkapnya|terkait|artikel terkait|berita terkait|simak|cek berita|ikuti|follow|bagikan|share|tag|topik|copyright|hak cipta|©|\(?[a-z ]{2,30}\/[a-z ]{2,30}\)?$)/i;
const TAIL_BOILER = /(kirim komentar|belum ada komentar|silahkan login|silakan login|data komentar anda|terms of use|pedoman media siber|info iklan|all rights? reserved|copyright|©|follow channel|channel telegram|klik di sini|tautan telah disalin|newsletter|google-site-verification|new password|redaksi\s*:|english version|baca juga|baca berita)/i;
export function contentLooksTruncated(html, platform) {
  if (!html || platform === 'video' || platform === 'sosmed') return false;
  const paras = String(html).split(/<\/(?:p|div|li|h[1-6]|blockquote)>|<br\s*\/?>/i).map((p) => p.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  while (paras.length > 1 && paras[paras.length - 1].length < 160 && FOOTER_LINE.test(paras[paras.length - 1])) paras.pop();
  paras[paras.length - 1] = paras[paras.length - 1].replace(/\s*(baca berita terkini[^.]*|(copyright|©)?[^.]*all rights? reserved\.?|hubungi (divisi|kami)[^.]*|english version)$/i, '.').replace(/[\s*_#~-]+$/, '');         // tanda pemformatan di ujung (mis. "*") bukan akhir kalimat
  const text = paras.join(' ');
  if (text.length < 200) return false;
  // Ekor halaman (kolom komentar, hak cipta, ajakan mengikuti, menu redaksi) di 700 karakter terakhir bukan bagian artikel: dipotong sebelum dinilai.
  const tail0 = Math.max(0, text.length - 700);
  const bm = TAIL_BOILER.exec(text.slice(tail0));
  const core = (bm ? text.slice(0, tail0 + bm.index) : text).trim();
  if (core.length < 200) return false;
  if (/(\[…\]|\.\.\.|…)$/.test(core)) return true;                  // elipsis eksplisit dari penerbit
  if (/[.!?"'”’)\]»:;]$/.test(core)) return false;                  // berakhir tanda baca: kalimat selesai
  // Tanpa tanda baca di ujung: dianggap terpotong hanya bila berhenti di TENGAH kalimat, yaitu kata terakhirnya berhuruf kecil (dengan, yang, untuk, ...).
  // Berakhir kata berhuruf besar atau angka (daftar agenda, nama "... Tbk", tanggal) atau penutup kutipan ("pungkasnya", "kata dia") bukan tanda terpotong.
  const lastWord = (core.match(/([\p{L}\p{N}]+)\W*$/u) || [])[1] || '';
  if (/nya$/i.test(lastWord) || /^dia$/i.test(lastWord)) return false;
  return /^\p{Ll}/u.test(lastWord);
}

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
    try { host = new URL(r.found_url).hostname; } catch { /* host kosong */ }
    adapters = [/(^|\.)news\.google\.com$/.test(host) ? 'google_news' : /(^|\.)(youtube\.com|youtu\.be)$/.test(host) ? 'youtube' : 'bing_news'];
    adaptersInferred = true;
  }
  const [also] = await db().query('SELECT domain, url, title, tier, score, DATE_FORMAT(seen_at, "%Y-%m-%d %H:%i:%s") AS `at` FROM news_also WHERE news_id = ? ORDER BY score DESC, id', [r.id]);
  // Perusahaan lain yang punya artikel yang sama (alamat penerbit sama): untuk tab per perusahaan di modal. Penilaian AI tiap perusahaan ada di barisnya sendiri.
  const [kembar] = await db().query(`SELECT n2.id, n2.company_id, COALESCE(c2.ticker, c2.name) AS label, c2.name AS company_name, n2.impact, n2.company_role, n2.stage FROM news_items n2 JOIN companies c2 ON c2.id = n2.company_id WHERE n2.id = ? OR n2.article_url = ? OR (n2.title_hash = ? AND n2.company_id <> ? AND ABS(TIMESTAMPDIFF(HOUR, n2.sort_at, ?)) <= 72) ORDER BY ${ROLE_RANK('n2')}, n2.id`, [r.id, r.article_url, r.title_hash, r.company_id, r.sort_at]);
  return { ...rest, kembar: kembar.length > 1 ? kembar : [], url: r.article_url || r.found_url, content_truncated: contentLooksTruncated(r.content_html, r.platform), juga_dimuat: also, risk_signals: j(r.risk_signals), risk_tags: j(r.risk_tags), found_via: via, adapters, adapters_inferred: adaptersInferred, published_at: r.sort_at };
}

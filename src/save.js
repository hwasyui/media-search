// Semua fungsi SIMPAN ke MySQL (schema media-search) ada di sini supaya bisa dipakai ulang dari mana saja.
// Membaca data ada di store.js. Semua fungsi di sini idempoten: menyimpan ulang data yang sama tidak menggandakan baris.
import { createHash } from 'node:crypto';
import { db } from './db.js';
import { maxSeverity } from './risk.js';
import { NEAR_DUP, buildMatcher, jaccard, normTitle, titleTokens } from './related.js';
import { listCompanies } from './store.js';
import { contentKind, platformOf } from './kind.js';

const sha1 = (s) => createHash('sha1').update(s).digest();
const trunc = (s, n) => (s == null ? null : String(s).slice(0, n));
const toDate = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  // Tanggal di luar rentang wajar (adapter kadang menghasilkan tahun 0000/epoch) dianggap tidak ada.
  const t = d.getTime();
  if (Number.isNaN(t) || t < Date.UTC(2000, 0, 1) || t > Date.now() + 2 * 86400000) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

const snippet0 = (it) => it.snippet ?? (it.text && it.text !== it.title ? it.text : null);
const domainOf = (u) => { try { return u ? new URL(u).hostname.replace(/^www\./, '') : null; } catch { return null; } };
// Thumbnail video YouTube dari ID di URL (tanpa request).
const youtubeThumb = (u) => {
  try {
    const x = new URL(u);
    const id = /(^|\.)youtu\.be$/.test(x.hostname) ? x.pathname.slice(1) : /(^|\.)youtube\.com$/.test(x.hostname) ? x.searchParams.get('v') : null;
    return id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : null;
  } catch { return null; }
};

// Berita/sinyal (hasil clean, + klasifikasi bila ada). Perusahaan + URL kanonik yang sama di-update, bukan dobel.
// Hasil AI yang sudah 'ok' tidak ditimpa oleh versi yang AI-nya gagal/dilewati.
// Duplikat (judul sama/mirip dengan berita lain perusahaan yang sama, URL berbeda) TIDAK disimpan; yang tersimpan hanya yang pertama.
// opts.dedupe = false dipakai saat memperbarui item yang sudah tersimpan (mis. hasil AI), agar tidak diperiksa ulang.
const I_URL_HASH = 1, I_URL = 2, I_TITLE = 3, I_TITLE_HASH = 31, I_FOUND_VIA = 32, I_CONTENT = 36, I_ART = 39;
async function dropDuplicates(companyId, rows) {
  const hex = (b) => b.toString('hex');
  const tHash = (r) => {
    if (!Buffer.isBuffer(r[I_TITLE_HASH])) throw new Error('urutan kolom baris simpan berubah: I_TITLE_HASH tidak lagi menunjuk hash judul');
    return r[I_TITLE_HASH];
  };
  const dropped = [];
  const keptRows = [];
  const keptTokens = [];
  const seenTitle = new Set();
  // 1) dalam batch yang sama
  for (const r of rows) {
    const th = hex(tHash(r)), tk = titleTokens(r[I_TITLE]);
    if (seenTitle.has(th) || keptTokens.some((k) => jaccard(tk, k) > NEAR_DUP)) { dropped.push({ r, ex: null }); continue; }
    seenTitle.add(th); keptTokens.push(tk); keptRows.push(r);
  }
  if (!keptRows.length) return { kept: [], dropped };
  // 2) terhadap berita yang sudah tersimpan (judul persis, lalu mirip dalam 21 hari terakhir); baris dengan URL yang sama bukan duplikat
  const [exact] = await db().query('SELECT HEX(url_hash) u, HEX(title_hash) t FROM news_items WHERE company_id = ? AND title_hash IN (?)', [companyId, keptRows.map(tHash)]);
  const exactMap = new Map();
  exact.forEach((e) => { (exactMap.get(e.t) || exactMap.set(e.t, new Set()).get(e.t)).add(e.u); });
  const [recent] = await db().query('SELECT HEX(url_hash) u, title FROM news_items WHERE company_id = ? AND sort_at >= UTC_TIMESTAMP() - INTERVAL 21 DAY ORDER BY id DESC LIMIT 4000', [companyId]);
  const recentTok = recent.map((x) => ({ u: x.u, tk: titleTokens(x.title) }));
  const kept = [];
  for (const r of keptRows) {
    const own = hex(r[I_URL_HASH]).toUpperCase();
    const ex = exactMap.get(hex(tHash(r)).toUpperCase());
    const exactDup = ex && [...ex].some((u) => u !== own);
    const tk = titleTokens(r[I_TITLE]);
    const nearHit = !exactDup ? recentTok.find((x) => x.u !== own && jaccard(tk, x.tk) > NEAR_DUP) : null;
    if (exactDup || nearHit) dropped.push({ r, ex: exactDup ? [...ex].find((u) => u !== own) : nearHit.u }); else kept.push(r);
  }
  return { kept, dropped };
}

export async function saveNews(companyId, items, opts = {}) {
  if (!companyId || !items?.length) return { saved: 0, inserted: 0, duplicates: 0, droppedUrls: [] };
  const company = (await listCompanies()).find((c) => c.id === companyId) || { name: companyId, aliases: [], stakeholders: [] };
  const matchRelated = buildMatcher(company);
  const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const origUrl = new Map();                      // baris -> tautan awal item (untuk droppedUrls); kolom url menyimpan alamat penerbit bila sudah diketahui
  const rows = items.filter((it) => it.url && it.title).map((it) => {
    const ai = it.ai || {};
    const cred = it.credibility || {};
    const aiStatus = !it.ai ? 'skipped' : ai.error ? 'failed' : 'ok';
    const host = cred.host || '';
    const sourceKey = it.sourceKey || (/(^|\.)(youtube\.com|youtu\.be)$/.test(host) ? 'youtube' : cred.key === 'social_forum' ? 'social_media' : 'news');
    const snippet = it.snippet ?? (it.text && it.text !== it.title ? it.text.replace(it.title, '').replace(/^\s*[—-]\s*/, '') : null);
    // Tag risiko hanya dari AI (membaca isi artikel). Berita yang belum/gagal dinilai AI tidak diberi tag (bukan ditebak dari kata kunci).
    const tags = aiStatus === 'ok' && Array.isArray(ai.risk_items)
      ? ai.risk_items.map((x) => ({ cat: x.category, severity: x.severity, hit: x.evidence })).sort((a, b) => b.severity - a.severity)
      : [];
    // Pencocokan nama (fakta, bukan tafsir) kini juga membaca isi artikel, bukan hanya judul+cuplikan. Ini hanya penentu tampilan SEBELUM AI menilai;
    // setelah dinilai AI, relevansi ditentukan AI dari isi (lihat VIEW news_cleaned).
    const rel = matchRelated((it.title || '') + ' ' + (snippet0(it) || '') + ' ' + (it.fullContent || ''));
    const platform = platformOf({ domain: domainOf(it.sourceUrl) || host, tier: cred.key });
    const kind = aiStatus === 'ok' && ai.konten_konsumen ? 'konsumen' : contentKind({ tier: cred.key, platform });
    const imageUrl = it.image || youtubeThumb(it.url) || null;
    const sourceDomain = domainOf(it.sourceUrl) || (/(^|\.)news\.google\.com$/.test(host) ? null : host.replace(/^www\./, '')) || null;
    const row = [
      companyId, sha1(it.canonical || it.url), trunc(it.articleUrl || it.url, 2048), trunc(it.title, 1000), snippet || null,
      trunc(it.sourceName || it.platform || host, 255), sourceKey, trunc(it.keyword || it.matchedKeywords?.join(', '), 255), trunc(it.modifier, 40), toDate(it.date), nowUtc,
      cred.key || null, cred.score ?? null, ai.impact || null, trunc(ai.impact_reason, 500), trunc(ai.status_line, 500),
      aiStatus, trunc(ai.error, 500),
      ai.relevant == null ? null : ai.relevant ? 1 : 0, trunc(ai.category, 60), trunc(ai.sentiment, 20),
      ai.confidence == null || Number.isNaN(Number(ai.confidence)) ? null : Math.max(0, Math.min(100, Math.round(Number(ai.confidence) <= 1 ? Number(ai.confidence) * 100 : Number(ai.confidence)))),   // AI memberi 0-1; simpan sebagai persen
      ai.reason ?? null, ai.risk_signals ? JSON.stringify(ai.risk_signals) : null, trunc(ai.topic, 255),
      trunc(imageUrl, 1024), trunc(sourceDomain, 255), tags.length ? JSON.stringify(tags) : null, maxSeverity(tags),
      rel.related ? 1 : 0, trunc(rel.via, 120), sha1(normTitle(it.title)),
      it.via?.length ? JSON.stringify(it.via) : null, nowUtc, platform, kind,
      it.contentHtml || null,
      aiStatus === 'ok' ? (ai.summary ?? '') : null, aiStatus === 'ok' ? ai.company_role || null : null,
      it.articleUrl ? trunc(it.articleUrl, 2048) : null, it.linkError || null,
    ];
    origUrl.set(row, it.url);
    return row;
  });
  let rowsToSave = rows, droppedUrls = [];
  if (opts.dedupe !== false) {
    const { kept, dropped } = await dropDuplicates(companyId, rows);
    rowsToSave = kept; droppedUrls = dropped.map((d) => origUrl.get(d.r) ?? d.r[I_URL]);
    // berita asli yang terlihat lagi di crawl ini: tambah hitungan, perbarui waktu terakhir, dan isi jejak penemuan bila masih kosong
    // Bila versi duplikat membawa cuplikan/gambar yang belum dimiliki berita aslinya (mis. Bing memberi cuplikan, Google News tidak), isinya digabung.
    // found_via digabung juga, sehingga tercatat SEMUA alat yang menemukan berita ini (maks. 10 jejak).
    const exHex = [...new Set(dropped.filter((d) => d.ex).map((d) => d.ex))];
    const existing = new Map();
    if (exHex.length) {
      const [rows] = await db().query('SELECT HEX(url_hash) u, found_via FROM news_items WHERE company_id = ? AND url_hash IN (?)', [companyId, exHex.map((h) => Buffer.from(h, 'hex'))]);
      rows.forEach((r) => existing.set(r.u, typeof r.found_via === 'string' ? JSON.parse(r.found_via) : r.found_via));
    }
    for (const d of dropped) {
      if (!d.ex) continue;
      const now = existing.get(d.ex) || [];
      const add = d.r[I_FOUND_VIA] ? JSON.parse(d.r[I_FOUND_VIA]) : [];
      const merged = [...now];
      for (const v of add) if (merged.length < 10 && !merged.some((x) => x.src === v.src && x.q === v.q)) merged.push(v);
      existing.set(d.ex, merged);
      await db().query(
        `UPDATE news_items SET seen_count = seen_count + 1, last_seen_at = ?, found_via = ?,
           snippet = IF(snippet IS NULL OR snippet = '', ?, snippet), content_html = COALESCE(content_html, ?), url = IF(? IS NOT NULL, ?, url), article_url = COALESCE(article_url, ?), image_url = COALESCE(image_url, ?), source_domain = COALESCE(source_domain, ?)
         WHERE company_id = ? AND url_hash = UNHEX(?)`,
        [nowUtc, merged.length ? JSON.stringify(merged) : null, d.r[4], d.r[I_CONTENT], d.r[I_ART], d.r[I_ART], d.r[I_ART], d.r[25], d.r[26], companyId, d.ex],
      );
    }
  }
  const count = async () => (await db().query('SELECT COUNT(*) n FROM news_items WHERE company_id = ?', [companyId]))[0][0].n;
  const before = await count();
  // Hitungan 'terlihat berapa kali' hanya bertambah pada penyimpanan hasil crawl, bukan saat memperbarui hasil AI (dedupe:false).
  const seenClause = opts.dedupe === false ? 'seen_count = seen_count' : 'seen_count = seen_count + 1, last_seen_at = VALUES(last_seen_at)';
  for (let i = 0; i < rowsToSave.length; i += 200) {
    await db().query(
      `INSERT INTO news_items (company_id,url_hash,url,title,snippet,source_name,source_key,keyword,modifier,published_at,fetched_at,
        credibility_tier,credibility_score,impact,impact_reason,status_line,ai_status,ai_error,relevant,category,sentiment,
        confidence,reason,risk_signals,topic,image_url,source_domain,risk_tags,risk_level,related,related_via,title_hash,found_via,last_seen_at,platform,content_kind,content_html,ai_summary,company_role,article_url,link_error) VALUES ?
       ON DUPLICATE KEY UPDATE
        published_at = COALESCE(VALUES(published_at), published_at),
        risk_tags = IF(VALUES(ai_status) <> 'ok' AND ai_status = 'ok', risk_tags, VALUES(risk_tags)),
        risk_level = IF(VALUES(ai_status) <> 'ok' AND ai_status = 'ok', risk_level, VALUES(risk_level)),
        url = IF(VALUES(article_url) IS NOT NULL, VALUES(url), url), article_url = COALESCE(article_url, VALUES(article_url)), link_error = IF(article_url IS NOT NULL OR VALUES(article_url) IS NOT NULL, NULL, COALESCE(VALUES(link_error), link_error)),
        ai_summary = IF(VALUES(ai_status) = 'ok', VALUES(ai_summary), ai_summary), company_role = IF(VALUES(ai_status) = 'ok', VALUES(company_role), company_role),
        related = VALUES(related), related_via = VALUES(related_via), title_hash = VALUES(title_hash),
        found_via = COALESCE(found_via, VALUES(found_via)), platform = VALUES(platform), content_kind = IF(VALUES(ai_status) <> 'ok' AND ai_status = 'ok', content_kind, VALUES(content_kind)),
        ${seenClause},
        image_url = COALESCE(VALUES(image_url), image_url), source_domain = COALESCE(VALUES(source_domain), source_domain),
        source_name = COALESCE(VALUES(source_name), source_name), source_key = COALESCE(VALUES(source_key), source_key),
        snippet = COALESCE(VALUES(snippet), snippet), content_html = COALESCE(VALUES(content_html), content_html), keyword = COALESCE(VALUES(keyword), keyword),
        credibility_tier = COALESCE(VALUES(credibility_tier), credibility_tier), credibility_score = COALESCE(VALUES(credibility_score), credibility_score),
        impact = IF(VALUES(ai_status) <> 'ok' AND ai_status = 'ok', impact, COALESCE(VALUES(impact), impact)),
        impact_reason = IF(VALUES(ai_status) <> 'ok' AND ai_status = 'ok', impact_reason, COALESCE(VALUES(impact_reason), impact_reason)), status_line = COALESCE(VALUES(status_line), status_line),
        ai_error = IF(VALUES(ai_status) = 'ok', NULL, VALUES(ai_error)),
        relevant = IF(VALUES(ai_status) = 'ok', VALUES(relevant), relevant),
        category = IF(VALUES(ai_status) = 'ok', VALUES(category), category),
        sentiment = IF(VALUES(ai_status) = 'ok', VALUES(sentiment), sentiment),
        confidence = IF(VALUES(ai_status) = 'ok', VALUES(confidence), confidence),
        reason = IF(VALUES(ai_status) = 'ok', VALUES(reason), reason),
        risk_signals = IF(VALUES(ai_status) = 'ok', VALUES(risk_signals), risk_signals),
        topic = IF(VALUES(ai_status) = 'ok', VALUES(topic), topic),
        ai_status = IF(VALUES(ai_status) = 'ok' OR ai_status <> 'ok', VALUES(ai_status), ai_status)`,
      [rowsToSave.slice(i, i + 200)],
    );
  }
  const inserted = (await count()) - before;
  await db().query('UPDATE companies SET last_crawl_at = UTC_TIMESTAMP() WHERE id = ?', [companyId]);
  return { saved: rowsToSave.length, inserted, duplicates: rows.length - rowsToSave.length, droppedUrls };
}

// Snapshot keuangan; dilewati kalau sudah ada snapshot < 10 menit untuk perusahaan yang sama. true = tersimpan.
export async function saveFinancial(companyId, d, { force = false } = {}) {
  const [[last]] = await db().query('SELECT MAX(fetched_at) t FROM financial_snapshots WHERE company_id = ?', [companyId]);
  if (!force && last?.t && Date.now() - new Date(last.t).getTime() < 10 * 60 * 1000) return false;
  await db().query(
    'INSERT INTO financial_snapshots (company_id,ticker,price,change_5d_pct,change_1m_pct,data) VALUES (?,?,?,?,?,?)',
    [companyId, d.ticker, d.price?.price ?? null, d.price?.change5dPct ?? null, d.price?.change1mPct ?? null, JSON.stringify(d)],
  );
  return true;
}

// Laporan simulate/cron -> crawl_runs. Mengembalikan nama laporan, mis. "simulate-12".
export async function saveReport(type, report, companyId = null) {
  const [res] = await db().query(
    'INSERT INTO crawl_runs (type,company_id,finished_at,status,items_fetched,items_new,report) VALUES (?,?,UTC_TIMESTAMP(),?,?,?,?)',
    [type, companyId, 'done', report.raw?.total ?? 0, report.saved?.inserted ?? 0, JSON.stringify(report)],
  );
  return `${type}-${res.insertId}`;
}

// Daftarkan / perbarui perusahaan + stakeholder-nya. id dibuat dari nama (slug) kalau tidak diberikan.
// Mengembalikan objek perusahaan lengkap (bentuk sama seperti listCompanies).
export async function saveCompany(c) {
  const slug = (s) => String(s).toLowerCase().replace(/\b(pt|tbk|persero|\(persero\))\b/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  const id = c.id || slug(c.ticker || c.name);
  if (!id) throw new Error('nama perusahaan tidak valid');
  const type = c.type === 'public' ? 'public' : 'private';
  await db().query(
    `INSERT INTO companies (id,name,type,ticker,sector,aliases) VALUES (?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE name=VALUES(name), type=VALUES(type), ticker=VALUES(ticker), sector=VALUES(sector), aliases=VALUES(aliases)`,
    [id, trunc(c.name, 255), type, c.ticker || null, trunc(c.sector, 100), JSON.stringify(c.aliases || [])],
  );
  for (const s of c.stakeholders || []) {
    if (!s?.name) continue;
    await db().query('INSERT INTO stakeholders (company_id,name,role) VALUES (?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role)', [id, trunc(s.name, 191), trunc(s.role, 255)]);
  }
  return { id, name: c.name, type, ticker: c.ticker || undefined, sector: c.sector, aliases: c.aliases || [], stakeholders: c.stakeholders || [] };
}

// Simpan hasil analisis AI (riwayat). generated_at diisi eksplisit (UTC).
export async function saveAnalysis(companyId, a) {
  const [res] = await db().query(
    'INSERT INTO company_analyses (company_id,generated_at,model,news_count,rating_risiko,kondisi,headline,content) VALUES (?,UTC_TIMESTAMP(),?,?,?,?,?,?)',
    [companyId, trunc(a.model, 80), a.newsCount || 0, trunc(a.rating_risiko, 20), trunc(a.kondisi, 20), trunc(a.headline, 255), JSON.stringify(a)],
  );
  return res.insertId;
}

// Simpan status job Task Runner (dipanggil saat checkpoint, tiap beberapa detik, dan saat selesai).
const sqlDate = (ms) => (ms ? new Date(ms).toISOString().slice(0, 19).replace('T', ' ') : null);
export async function saveJobRun(j) {
  await db().query(
    `INSERT INTO job_runs (id,type,status,options,progress,checkpoint,logs,error,resumed_from,created_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), progress=VALUES(progress), checkpoint=VALUES(checkpoint), logs=VALUES(logs),
       error=VALUES(error), finished_at=VALUES(finished_at)`,
    [j.id, j.type, j.status, JSON.stringify(j.opts || {}), JSON.stringify(j.progress || {}), JSON.stringify(j.checkpoint || {}),
      JSON.stringify((j.logs || []).slice(-300)), trunc(j.error, 500), j.resumedFrom || null, sqlDate(j.createdAt), sqlDate(j.finishedAt)],
  );
}
// Dipanggil saat server start: job yang masih 'running' berarti prosesnya mati di tengah jalan.
export async function markJobsInterrupted() {
  // finished_at = detak terakhir job (progress.beatAt, disimpan tiap beberapa detik), bukan waktu server hidup lagi, supaya durasi tidak menghitung waktu server mati.
  const [r] = await db().query(
    `UPDATE job_runs SET status = 'interrupted',
       finished_at = COALESCE(FROM_UNIXTIME(JSON_UNQUOTE(JSON_EXTRACT(progress, '$.beatAt')) / 1000), UTC_TIMESTAMP())
     WHERE status IN ('running','waiting')`,
  );
  return r.affectedRows;
}

// Snapshot profil risiko. Dilewati bila hasil sama persis dengan snapshot terakhir dan umurnya < 10 menit (hindari baris dobel).
export async function saveRiskProfile(companyId, p, trigger = 'view') {
  const [[last]] = await db().query('SELECT score, rating, computed_at FROM risk_profiles WHERE company_id = ? ORDER BY id DESC LIMIT 1', [companyId]);
  if (last && last.score === p.score && last.rating === p.rating && Date.now() - new Date(last.computed_at).getTime() < 10 * 60 * 1000) return false;
  await db().query(
    'INSERT INTO risk_profiles (company_id,computed_at,trigger_src,score,rating,categories,factors,checklist,caveats,coverage) VALUES (?,UTC_TIMESTAMP(),?,?,?,?,?,?,?,?)',
    [companyId, trigger, p.score, p.rating, JSON.stringify(p.categories), JSON.stringify(p.factors.slice(0, 40)), JSON.stringify(p.checklist), JSON.stringify(p.caveats), JSON.stringify(p.coverage)],
  );
  return true;
}

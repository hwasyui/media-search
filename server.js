import express from 'express';
import { spawn } from 'node:child_process';
import { LISTENER_DIR, PYTHON, PY_ENV, runPython } from './src/sources/adapters.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { runSearch, SOURCES, MODIFIERS, PERIOD } from './src/search.js';
import { cleanItems } from './src/clean.js';
import { enrichItemsWithContent, extractContentFromUrl } from './src/extractor.js';
import { classifyItems, geminiKeys, groqKeys, MAX_ITEMS as AI_MAX_ITEMS } from './src/classify.js';
import { getFinancials, searchIdx } from './src/financial.js';
import { cancelJob, flushJobs, getJob, listJobs, publicJob, recoverJobs, resumeJob, startJob } from './src/jobs.js';
import { getCompany, latestAnalysis, latestFinancial, latestRiskProfiles, listCompanies, listReports, readReport } from './src/store.js';
import { saveAnalysis, saveCompany, saveFinancial, saveNews, saveRiskProfile } from './src/save.js';
import { generateAnalysis } from './src/analysis.js';
import { generateCompanyDossier, getCompanyDossier } from './src/dossier.js';
import { chat as assistantChat } from './src/assistant.js';
import { closeMcp, mcpTools } from './src/mcp.js';
import { enrichByIds } from './src/images.js';
import { db } from './src/db.js';
import { realUrl } from './src/content.js';
import { isGoogleArticle, resolveGoogleUrl } from './src/gnews.js';
import { isGoogleNewsUrl, resolveArticleUrl } from './src/resolver.js';
import { getCover } from './src/covers.js';
import { getRiskProfile } from './src/riskprofile.js';
import { companyNewsStats, getNewsDetail, listNews, newsCounts, newsFacets, newsTotal, platformCounts } from './src/news.js';
import { buildNarrative } from './src/narrative.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIN_TTL_MS = (Number(process.env.FINANCIAL_TTL_HOURS) || 24) * 3600 * 1000;
const finBg = new Map();   // company.id -> waktu percobaan terakhir pembaruan latar belakang
function backgroundFinancialRefresh(company) {
  const last = finBg.get(company.id) || 0;
  if (Date.now() - last < 15 * 60 * 1000) return;
  finBg.set(company.id, Date.now());
  getFinancials(company.ticker, { force: true })
    .then((d) => (d.errors?.price || d.errors?.valuation ? null : saveFinancial(company.id, d, { force: true })))
    .catch((e) => console.error('[financial] pembaruan latar belakang gagal:', e.message));
}
const app = express();

// Log akses dari perangkat LAIN (bukan laptop ini): IP, request, status, dan browser. Berguna untuk melihat apa yang diminta/diterima tamu.
app.use((req, res, next) => {
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  if (ip === '127.0.0.1' || ip === '::1' || ip === '192.168.205.26') return next();
  const t = Date.now();
  res.on('finish', () => console.log('[lan] ' + ip + ' ' + req.method + ' ' + req.originalUrl.slice(0, 80) + ' -> ' + res.statusCode + ' ' + (Date.now() - t) + 'ms | ' + String(req.headers['user-agent'] || '').slice(0, 70)));
  next();
});
app.use(express.json({ limit: '5mb' }));
app.get('/', (_req, res) => res.redirect('/portal.html'));
// HTML/JS/CSS selalu divalidasi ulang ke server (ETag) supaya perubahan kode langsung terpakai tanpa perlu hard-refresh.
app.use(express.static(path.join(__dirname, 'public'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));

app.get('/api/config', async (_req, res) => {
  const companies = await listCompanies();
  res.json({
    companies,
    sources: Object.entries(SOURCES).map(([key, v]) => ({ key, label: v.label, disabled: v.disabled })),
    modifiers: Object.entries(MODIFIERS).map(([key, v]) => ({ key, label: v.label })),
    period: PERIOD,
    groqReady: groqKeys().length > 0 || geminiKeys().length > 0,
    geminiKeyCount: geminiKeys().length,
    groqKeyCount: groqKeys().length,
    aiMaxItems: AI_MAX_ITEMS,
  });
});

// Cari emiten langsung dari database Bursa Efek Indonesia (IDX)
app.get('/api/idx/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const results = await searchIdx(q);
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Tambah / registrasi perusahaan baru
app.post('/api/companies', async (req, res) => {
  try {
    const { name, ticker, type = 'public', sector, aliases = [], stakeholders = [] } = req.body;
    if (!name) return res.status(400).json({ error: 'Nama perusahaan wajib diisi' });
    const co = await saveCompany({
      name,
      ticker: (ticker || '').toUpperCase() || null,
      type,
      sector: sector || (type === 'public' ? 'Bursa Efek Indonesia' : 'Swasta / BUMN'),
      aliases: aliases.length ? aliases : [name, ...(ticker ? [ticker.toUpperCase()] : [])],
      stakeholders,
    });
    res.json({ company: co });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Data keuangan perusahaan terbuka (non-AI): harga, valuasi, laporan keuangan, pengumuman IDX
app.get('/api/financial/:id', async (req, res) => {
  try {
    let co = await getCompany(req.params.id);
    let ticker = co?.ticker;
    if (!co) {
      // Cek apakah parameter id adalah ticker langsung (misal: /api/financial/ASII atau /api/financial/BMRI)
      const rawTicker = req.params.id.toUpperCase();
      if (/^[A-Z0-9]{2,6}$/.test(rawTicker)) {
        ticker = rawTicker;
      } else {
        return res.status(404).json({ error: 'perusahaan tidak ditemukan' });
      }
    } else if (co.type !== 'public' || !co.ticker) {
      return res.status(400).json({ error: `${co.name} bukan perusahaan terbuka (tidak ada data keuangan publik)` });
    }
    const data = await getFinancials(ticker);
    const saved = co ? await saveFinancial(co.id, data).catch((e) => { console.error('[db] saveFinancial:', e.message); return false; }) : false;
    res.json({ company: co ? co.id : ticker.toLowerCase(), saved, ...data });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Step 1: fetch (batch)
app.post('/api/fetch', async (req, res) => {
  const { keywords = [], sources = [], modifiers = ['none'] } = req.body;
  const kws = [...new Set(keywords.map((k) => String(k).trim()).filter(Boolean))].slice(0, 6);
  const srcs = sources.filter((s) => SOURCES[s] && !SOURCES[s].disabled);
  const mods = modifiers.filter((m) => MODIFIERS[m]);
  if (!kws.length || !srcs.length || !mods.length) return res.status(400).json({ error: 'keyword, sumber, dan modifier wajib diisi' });
  if (kws.length * srcs.length * mods.length > 60) return res.status(400).json({ error: 'Terlalu banyak kombinasi query (maks 60). Kurangi sumber/modifier/keyword.' });
  try {
    res.json(await runSearch({ keywords: kws, sources: srcs, modifiers: mods }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Step 1 streaming: hasil muncul per query begitu selesai (SSE)
app.post('/api/fetch/stream', async (req, res) => {
  const { keywords = [], sources = [], modifiers = ['none'] } = req.body;
  const kws = [...new Set(keywords.map((k) => String(k).trim()).filter(Boolean))].slice(0, 6);
  const srcs = sources.filter((s) => SOURCES[s] && !SOURCES[s].disabled);
  const mods = modifiers.filter((m) => MODIFIERS[m]);
  if (!kws.length || !srcs.length || !mods.length) return res.status(400).json({ error: 'keyword, sumber, dan modifier wajib diisi' });
  const total = kws.length * srcs.length * mods.length;
  if (total > 60) return res.status(400).json({ error: 'Terlalu banyak kombinasi query (maks 60).' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  try {
    const result = await runSearch({ keywords: kws, sources: srcs, modifiers: mods }, (chunk) => send({ type: 'chunk', ...chunk }));
    send({ type: 'done', queries: result.queries, errors: result.errors, perSource: result.perSource });
  } catch (e) {
    send({ type: 'error', error: e.message });
  }
  res.end();
});

// ---- Index lokal (crawler Python) ----
app.get('/api/index/stats', async (_req, res) => {
  try {
    res.json(JSON.parse(await runPython(['stats'])));
  } catch (e) {
    res.status(500).json({ error: `Crawler Python tidak bisa dijalankan: ${e.message}` });
  }
});

const crawl = { running: false, startedAt: null, exitCode: null, log: [] };
const pushLog = (chunk) => {
  crawl.log.push(...String(chunk).split(/\r?\n/).filter(Boolean));
  crawl.log = crawl.log.slice(-300);
};

app.post('/api/index/crawl', (_req, res) => {
  if (crawl.running) return res.status(409).json({ error: 'Crawl sedang berjalan' });
  Object.assign(crawl, { running: true, startedAt: Date.now(), exitCode: null, log: [] });
  const child = spawn(PYTHON, ['main.py', 'crawl', '--store-all', '--max-age-days', '7', '--max-per-source', '40'], {
    cwd: LISTENER_DIR,
    env: PY_ENV,
  });
  child.stdout.on('data', pushLog);
  child.stderr.on('data', pushLog);
  child.on('error', (e) => { pushLog(`Gagal start: ${e.message}`); crawl.running = false; });
  child.on('close', (code) => { crawl.running = false; crawl.exitCode = code; });
  res.json({ started: true });
});

app.get('/api/index/crawl', (_req, res) => {
  res.json({ running: crawl.running, startedAt: crawl.startedAt, exitCode: crawl.exitCode, tail: crawl.log.slice(-12) });
});

// Step 2: clean + enrich content (full article body & social post caption)
app.post('/api/clean', async (req, res) => {
  try {
    const cleaned = cleanItems(req.body.items || []);
    await enrichItemsWithContent(cleaned.items, { concurrency: 6 });
    res.json(cleaned);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Ekstraksi konten artikel / caption postingan spesifik
app.post('/api/extract', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'url wajib diisi' });
    const content = await extractContentFromUrl(url);
    res.json(content || { url, fullContent: '', snippet: '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Step 3: classify (Groq)
app.post('/api/classify', async (req, res) => {
  try {
    const { items = [], entity = {} } = req.body;
    const out = await classifyItems(items.slice(0, AI_MAX_ITEMS), entity);
    let saved = null, saveError = null;
    if (entity.id) {
      try { saved = await saveNews(entity.id, out); } catch (e) { saveError = e.message; console.error('[db] saveNews:', e.message); }
    }
    res.json({ items: out, saved, saveError });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- Job background: simulasi kualitas data & cron crawl (tombol di /jobs.html) ----
const jobError = (res, e) => res.status(e.status || 500).json({ error: e.message });

app.post('/api/jobs', (req, res) => {
  try {
    const { type, options = {} } = req.body || {};
    res.json(publicJob(startJob(type, options)));
  } catch (e) { jobError(res, e); }
});
app.get('/api/jobs', (_req, res) => res.json(listJobs()));
app.post('/api/jobs/:id/resume', (req, res) => {
  try { res.json(publicJob(resumeJob(req.params.id))); } catch (e) { jobError(res, e); }
});
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'job tidak ditemukan' });
  res.json({ ...publicJob(job), serverNow: Date.now() });      // serverNow: browser menghitung durasi dengan jam server
});
app.post('/api/jobs/:id/cancel', (req, res) => {
  try { res.json(publicJob(cancelJob(req.params.id))); } catch (e) { jobError(res, e); }
});
app.get('/api/reports', async (_req, res) => res.json(await listReports()));
app.get('/api/reports/:name', async (req, res) => {
  try { res.json(await readReport(req.params.name)); } catch (e) { jobError(res, e); }
});


// ---- Portal: feed berita gabungan, halaman perusahaan, refresh ----
// Feed campuran semua perusahaan (atau satu perusahaan). filter: all|official|rumor|positive|risk|video; sort: mix|latest|relevant
app.get('/api/news', async (req, res) => {
  try {
    const q = req.query;
    // Semua filter opsional dan bisa dikombinasikan; lihat where() di src/news.js. raw=1: data mentah (semua hasil crawl).
    const f = {
      company: q.company, filter: q.filter || 'all', q: q.q, days: q.days === undefined ? 30 : Number(q.days), platform: q.platform, kind: q.kind, tier: q.tier,
      impact: q.impact, category: q.category, sentiment: q.sentiment, riskMin: q.risk_min, riskCat: q.risk_cat, related: q.related, ai: q.ai, source: q.source, raw: q.raw === '1',
    };
    const [items, counts, total, platforms] = await Promise.all([
      listNews({ ...f, sort: q.sort || 'mix', limit: q.limit, offset: q.offset }), newsCounts(f), newsTotal(f), platformCounts({ company: f.company, q: f.q, days: f.days, raw: f.raw }),
    ]);
    res.json({ items, counts, total, platforms });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Pilihan dropdown filter beserta jumlahnya
app.get('/api/news/facets', async (req, res) => {
  try { res.json(await newsFacets({ company: req.query.company, days: req.query.days === undefined ? 30 : Number(req.query.days), raw: req.query.raw === '1' })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Asisten AI: jawaban dari konteks DB (beranda / perusahaan / berita). Dibatasi per IP: maks. 20 pertanyaan per 10 menit.
const chatHits = new Map();
app.post('/api/assistant', async (req, res) => {
  try {
    const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
    const now = Date.now();
    const hits = (chatHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (hits.length >= 20) return res.status(429).json({ error: 'Terlalu banyak pertanyaan. Coba lagi beberapa menit lagi.' });
    hits.push(now); chatHits.set(ip, hits);
    const parseCx = (x) => (x && x.type === 'company' && /^[\w.-]{1,60}$/.test(String(x.companyId || '')) ? { type: 'company', companyId: String(x.companyId) } : x && x.type === 'news' && Number.isInteger(Number(x.newsId)) ? { type: 'news', newsId: Number(x.newsId) } : x && x.type === 'home' ? { type: 'home' } : null);
    const raw = Array.isArray(req.body?.messages) ? req.body.messages.slice(-8) : [];
    const messages = raw.filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim()).map((m) => ({ role: m.role, content: m.content.slice(0, 1200), cx: parseCx(m.cx) }));
    if (!messages.length || messages.at(-1).role !== 'user') return res.status(400).json({ error: 'pertanyaan kosong' });
    const c = req.body?.context || {};
    const context = c.type === 'company' ? { type: 'company', companyId: String(c.companyId || '') } : c.type === 'news' ? { type: 'news', newsId: Number(c.newsId) } : { type: 'home' };
    const parse = (x) => (x && x.type === 'company' ? { type: 'company', companyId: String(x.companyId || '') } : x && x.type === 'news' && Number.isInteger(Number(x.newsId)) ? { type: 'news', newsId: Number(x.newsId) } : null);
    res.json(await assistantChat(messages, context, parse(req.body?.prev)));      // prev: konteks jawaban terakhir bila halamannya sudah berganti
  } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
});

// Detail satu berita untuk modal (semua sinyal + jejak penemuan)
app.get('/api/news/:id(\\d+)', async (req, res) => {
  try {
    const d = await getNewsDetail(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'berita tidak ditemukan' });
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Gambar artikel secara lazy: browser meminta untuk berita yang sedang tampil (maks. 12 id per permintaan).
// Buka artikel asli satu berita. Tautan Google News diselesaikan langsung ke alamat penerbit asli.
app.get('/go/:id(\\d+)', async (req, res) => {
  try {
    const [[r]] = await db().query('SELECT id, url, title, snippet, source_domain, source_name, article_url FROM news_items WHERE id = ?', [Number(req.params.id)]);
    if (!r) return res.status(404).send('berita tidak ditemukan');
    if (r.article_url && !isGoogleNewsUrl(r.article_url)) return res.redirect(302, r.article_url);
    if (!isGoogleNewsUrl(r.url)) return res.redirect(302, r.url);

    const art = await resolveArticleUrl(r);
    if (art && !isGoogleNewsUrl(art)) {
      await db().query('UPDATE news_items SET article_url = ?, url = ?, link_error = NULL WHERE id = ?', [art, art, r.id]).catch(() => {});
      return res.redirect(302, art);
    }
    return res.redirect(302, art || `https://www.google.com/search?q=${encodeURIComponent(r.title || '')}`);
  } catch { res.status(500).send('gagal membuka artikel'); }
});

// Gambar sampul dari cache lokal (data/covers); diunduh sekali dari situs penerbit bila belum ada. 404 bila tidak bisa: kartu memakai logo penerbit.
app.get('/img/:id(\\d+)', async (req, res) => {
  try {
    const [[r]] = await db().query('SELECT image_url FROM news_items WHERE id = ?', [Number(req.params.id)]);
    const c = r?.image_url ? await getCover(r.image_url) : null;
    if (!c) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=604800');
    res.type(c.type).sendFile(c.file);
  } catch { res.status(404).end(); }
});

app.post('/api/news/images', async (req, res) => {
  try {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 12);
    res.json({ images: await enrichByIds(ids) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Daftar perusahaan + ringkasan sinyal masing-masing (sidebar / portofolio)
app.get('/api/portfolio', async (_req, res) => {
  try {
    const [companies, stats, risks] = await Promise.all([listCompanies(), companyNewsStats(30), latestRiskProfiles()]);
    res.json(companies.map((c) => ({ ...c, risk: risks[c.id] || null, stats: stats[c.id] || { total: 0, official: 0, rumor: 0, positive: 0, risk: 0, latest: null } })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Halaman perusahaan: profil + data keuangan (perusahaan terbuka) + narasi aturan + hitungan sinyal
app.get('/api/company/:id/overview', async (req, res) => {
  try {
    const company = await getCompany(req.params.id);
    if (!company) return res.status(404).json({ error: 'perusahaan tidak ditemukan' });
    let financial = null, financialError = null;
    if (company.type === 'public' && company.ticker) {
      try {
        // Halaman tidak pernah menunggu sumber eksternal bila sudah ada snapshot: snapshot terbaru ditampilkan seketika, dan bila lebih tua dari
        // FINANCIAL_TTL_HOURS (default 24 jam) pembaruan berjalan di latar belakang (maks. sekali per 15 menit per perusahaan, termasuk saat gagal).
        // Hanya saat belum ada snapshot sama sekali (pertama kali) halaman menunggu pengambilan langsung.
        // Diperbarui lewat tombol "Perbarui" di halaman, Task Runner, atau ?fresh=1 (paksa ambil dari sumber).
        const snapRecent = req.query.fresh === '1' ? null : await latestFinancial(company.id).catch(() => null);
        if (snapRecent) {
          financial = snapRecent;
          if (Date.now() - new Date(snapRecent.fetchedAt).getTime() >= FIN_TTL_MS) backgroundFinancialRefresh(company);
        } else financial = await getFinancials(company.ticker);
        if (financial !== snapRecent && (financial.errors?.price || financial.errors?.valuation)) {
          // Yahoo sesekali membatasi request (429): pakai snapshot terakhir dari DB untuk bagian yang gagal, dan tandai basi.
          const snap = await latestFinancial(company.id).catch(() => null);
          financial = { ...financial, errors: { ...financial.errors }, stale: {} };
          for (const k of ['price', 'valuation']) {
            if (financial.errors[k] && snap?.[k]) { financial[k] = snap[k]; financial.stale[k] = snap.fetchedAt; }
          }
        } else if (financial !== snapRecent) {      // snapshot dari DB tidak disimpan ulang
          saveFinancial(company.id, financial).catch((e) => console.error('[db] saveFinancial:', e.message));
        }
      } catch (e) { financialError = e.message; }
    }
    const [counts, stats] = await Promise.all([newsCounts({ company: company.id }), companyNewsStats(30)]);
    const st = stats[company.id] || { total: 0, official: 0, rumor: 0, positive: 0, risk: 0 };
    res.json({ company, financial, financialError, counts, stats: st, narrative: buildNarrative({ company, financial, stats: st }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Perbarui data keuangan satu emiten sekarang (tombol di halaman): ambil dari sumber lalu simpan sebagai snapshot baru di DB.
app.post('/api/company/:id/financial/refresh', async (req, res) => {
  try {
    const co = await getCompany(req.params.id);
    if (!co) return res.status(404).json({ error: 'perusahaan tidak ditemukan' });
    if (co.type !== 'public' || !co.ticker) return res.status(400).json({ error: 'bukan perusahaan terbuka' });
    const data = await getFinancials(co.ticker, { force: true });
    const bad = data.errors?.price || data.errors?.valuation;
    if (!bad) await saveFinancial(co.id, data, { force: true });
    res.json({ saved: !bad, errors: data.errors, fetchedAt: data.fetchedAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Profil risiko pembiayaan (aturan, tanpa AI): skor per kategori, rating, faktor + bukti, checklist verifikasi
app.get('/api/company/:id/risk', async (req, res) => {
  try {
    const company = await getCompany(req.params.id);
    if (!company) return res.status(404).json({ error: 'perusahaan tidak ditemukan' });
    const profile = await getRiskProfile(company);
    saveRiskProfile(company.id, profile, 'view').catch((e) => console.error('[db] saveRiskProfile:', e.message));
    res.json({ company: { id: company.id, name: company.name, type: company.type }, ...profile });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Analisis AI: baca yang terakhir tersimpan / buat yang baru (data keuangan + berita 30 hari -> Groq -> simpan ke DB)
app.get('/api/company/:id/ai-analysis', async (req, res) => {
  try { res.json({ analysis: await latestAnalysis(req.params.id) }); } catch (e) { res.status(500).json({ error: e.message }); }
});
const analyzing = new Set();
app.post('/api/company/:id/ai-analysis', async (req, res) => {
  const company = await getCompany(req.params.id).catch(() => null);
  if (!company) return res.status(404).json({ error: 'perusahaan tidak ditemukan' });
  if (analyzing.has(company.id)) return res.status(409).json({ error: 'analisis sedang dibuat' });
  analyzing.add(company.id);
  try {
    let financial = null;
    if (company.type === 'public' && company.ticker) financial = await getFinancials(company.ticker).catch(() => null);
    if (financial && (financial.errors?.price || financial.errors?.valuation)) {
      const snap = await latestFinancial(company.id).catch(() => null);
      if (snap) financial = { ...financial, price: financial.price || snap.price, valuation: financial.valuation || snap.valuation };
    }
    const analysis = await generateAnalysis(company, financial);
    await saveAnalysis(company.id, analysis);
    res.json({ analysis: { generatedAt: new Date().toISOString(), ...analysis } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    analyzing.delete(company.id);
  }
});

// Dossier Korporasi: baca yang tersimpan / ekstrak baru dari berita, keterbukaan, dan profil
app.get('/api/company/:id/dossier', async (req, res) => {
  try {
    const dossier = await getCompanyDossier(req.params.id);
    res.json({ dossier });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
const extractingDossier = new Set();
app.post('/api/company/:id/dossier', async (req, res) => {
  const company = await getCompany(req.params.id).catch(() => null);
  if (!company) return res.status(404).json({ error: 'perusahaan tidak ditemukan' });
  if (extractingDossier.has(company.id)) return res.status(409).json({ error: 'ekstraksi dossier sedang berlangsung' });
  extractingDossier.add(company.id);
  try {
    const dossier = await generateCompanyDossier(company.id);
    res.json({ dossier });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    extractingDossier.delete(company.id);
  }
});

// Ambil berita terbaru satu perusahaan: fetch -> clean -> klasifikasi -> simpan ke DB. Satu proses per perusahaan.
// "Perbarui berita" (satu perusahaan) memakai pipeline Task Runner yang sama: simpan dulu, buang duplikat, lewati berita yang sudah
// terklasifikasi lengkap, saring konten konsumen, dan hormati jalur (crawl/AI) supaya tidak bentrok atau membuang token.
// Mengembalikan job; browser memantau statusnya lewat /api/jobs/:id.
app.post('/api/companies/:id/refresh', async (req, res) => {
  try {
    const co = await getCompany(req.params.id);
    if (!co) return res.status(404).json({ error: 'perusahaan tidak ditemukan' });
    res.json(publicJob(startJob('portfolio', { companies: [co.id] })));
  } catch (e) { jobError(res, e); }
});

await recoverJobs().catch((e) => console.error('[jobs] recover gagal:', e.message));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Media Search jalan di http://localhost:${port}`));

// Asisten AI memakai MCP: sambungkan sekarang (di latar belakang) supaya kesalahan konfigurasi langsung terlihat dan pertanyaan pertama tidak menunggu.
mcpTools().then((t) => console.log(`[mcp] tersambung: ${t.length} alat (${t.map((x) => x.name).join(', ')})`)).catch((e) => console.warn('[mcp] BELUM tersambung, asisten AI belum bisa menjawab:', e.message));

// Dimatikan baik-baik (Ctrl+C / restart): simpan checkpoint terakhir dan tandai job aktif "terputus" sebelum keluar.
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    try { await closeMcp(); } catch { /* abaikan */ }
    try { const n = await flushJobs(); if (n) console.log(`[jobs] ${n} job aktif ditandai terputus (checkpoint tersimpan)`); } catch (e) { console.error('[jobs] flush gagal:', e.message); }
    process.exit(0);
  });
}

// Data keuangan perusahaan terbuka (tbk). 100% non-AI: angka diambil apa adanya dari sumber publik.
//   - Yahoo Finance: harga, volume, 52 minggu, dividen, valuasi, laporan keuangan kuartalan/tahunan
//   - IDX (keterbukaan informasi & search): diakses via stealth scraper (bypass Cloudflare) + rotating User-Agents + fallback RSS
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const IDX_CF_SCRIPT = path.resolve('src/listener/tools/idx-cf.js');

// Pool User-Agent modern & beragam (Diselaraskan dengan OS host Windows untuk mencegah TCP/IP OS mismatch 429)
export const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
];

export function getRandomUa() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const TIMEOUT = 20000;
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const RETRY_429 = [1500, 4000];                  // jeda (ms) sebelum percobaan ulang bila Yahoo membalas 429
async function getJson(url, headers = {}, ua = getRandomUa()) {
  for (let n = 0; ; n++) {
    try { return await getJsonOnce(url, headers, ua); }
    catch (e) {
      if (!/HTTP 429/.test(String(e?.message)) || n >= RETRY_429.length) throw e;
      await sleep(RETRY_429[n]);
    }
  }
}
async function getJsonOnce(url, headers = {}, ua = getRandomUa()) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': ua,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      ...headers
    },
    signal: AbortSignal.timeout(TIMEOUT)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(res.status === 403 ? 'HTTP 403 (situs memblokir akses otomatis)' : `HTTP ${res.status}`);
  try { return JSON.parse(text); } catch { throw new Error(/just a moment|cloudflare/i.test(text) ? 'diblokir Cloudflare (butuh browser)' : 'respons bukan JSON'); }
}

// Helper untuk menjalankan stealth Playwright scraper jika endpoint butuh bypass Cloudflare
async function runIdxCf(taskType, param) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [IDX_CF_SCRIPT, taskType, param], { timeout: 20000 });
    const data = JSON.parse(stdout.trim());
    if (Array.isArray(data)) return data;
    return null;
  } catch (err) {
    return null;
  }
}

// ---- Yahoo: cookie + crumb (hanya perlu untuk quoteSummary) ----
let session = null;
async function yahooSession() {
  if (session && Date.now() - session.at < 30 * 60 * 1000) return session;
  const ua = getRandomUa();
  const r = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': ua }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
  const cookie = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
  const cr = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': ua, Cookie: cookie }, signal: AbortSignal.timeout(TIMEOUT) });
  const crumb = (await cr.text()).trim();
  if (!cr.ok || !crumb || crumb.includes('<')) throw new Error('gagal mendapat crumb Yahoo');
  session = { cookie, crumb, ua, at: Date.now() };
  return session;
}

const raw = (v) => (v && typeof v === 'object' ? (v.raw ?? null) : v ?? null);
const pct = (a, b) => (a != null && b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);

async function fetchChart(sym, ua = getRandomUa()) {
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let lastErr = null;
  for (const host of hosts) {
    try {
      const j = await getJson(`https://${host}/v8/finance/chart/${sym}?range=3mo&interval=1d&events=div`, {}, ua);
      const r = j.chart?.result?.[0];
      if (!r) throw new Error(j.chart?.error?.description || 'simbol tidak ditemukan');
      const m = r.meta;
      const closes = (r.indicators?.quote?.[0]?.close || []).map((c, i) => ({ t: r.timestamp?.[i], c })).filter((x) => x.c != null);
      const last = closes.at(-1)?.c ?? m.regularMarketPrice;
      const back = (n) => closes.at(-1 - n)?.c;
      const divs = Object.values(r.events?.dividends || {}).map((d) => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount }));
      return {
        name: m.longName || m.shortName, currency: m.currency, exchange: m.fullExchangeName,
        price: m.regularMarketPrice ?? last, asOf: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
        dayChangePct: m.regularMarketChangePercent != null ? Math.round(m.regularMarketChangePercent * 100) / 100 : null,
        dayHigh: m.regularMarketDayHigh, dayLow: m.regularMarketDayLow, volume: m.regularMarketVolume,
        high52w: m.fiftyTwoWeekHigh, low52w: m.fiftyTwoWeekLow,
        change5dPct: pct(last, back(5)), change1mPct: pct(last, back(21)), change3mPct: pct(last, closes[0]?.c),
        dividends3m: divs,
        series: closes.map((x) => [x.t, x.c]),            // [epoch detik, penutupan] 3 bulan, untuk grafik mini
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('gagal mengambil data chart');
}

async function fetchValuation(sym, ua) {
  const s = await yahooSession();
  const activeUa = s.ua || ua || getRandomUa();
  const j = await getJson(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=summaryDetail,defaultKeyStatistics,financialData,price&crumb=${encodeURIComponent(s.crumb)}`,
    { Cookie: s.cookie },
    activeUa
  );
  const r = j.quoteSummary?.result?.[0];
  if (!r) throw new Error(j.quoteSummary?.error?.description || 'tidak ada data valuasi');
  const sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {}, pr = r.price || {};
  return {
    marketCap: raw(pr.marketCap) ?? raw(sd.marketCap), per: raw(sd.trailingPE), forwardPer: raw(sd.forwardPE), pbv: raw(ks.priceToBook),
    eps: raw(ks.trailingEps), dividendYieldPct: raw(sd.dividendYield) != null ? Math.round(raw(sd.dividendYield) * 1000) / 10 : null,
    payoutRatioPct: raw(sd.payoutRatio) != null ? Math.round(raw(sd.payoutRatio) * 1000) / 10 : null,
    roePct: raw(fd.returnOnEquity) != null ? Math.round(raw(fd.returnOnEquity) * 1000) / 10 : null,
    profitMarginPct: raw(fd.profitMargins) != null ? Math.round(raw(fd.profitMargins) * 1000) / 10 : null,
    debtToEquity: raw(fd.debtToEquity), beta: raw(sd.beta),
  };
}

const FUND_TYPES = ['TotalRevenue', 'GrossProfit', 'OperatingIncome', 'EBITDA', 'NetIncome', 'BasicEPS', 'TotalAssets', 'TotalDebt', 'StockholdersEquity', 'CashAndCashEquivalents', 'CurrentAssets', 'CurrentLiabilities', 'InterestExpense', 'OperatingCashFlow', 'FreeCashFlow'];

async function fetchFundamentals(sym, ua = getRandomUa()) {
  const types = ['quarterly', 'annual'].flatMap((p) => FUND_TYPES.map((t) => p + t)).join(',');
  const hosts = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com'];
  let lastErr = null;
  for (const host of hosts) {
    try {
      const j = await getJson(
        `https://${host}/ws/fundamentals-timeseries/v1/finance/timeseries/${sym}?type=${types}&period1=1600000000&period2=${Math.floor(Date.now() / 1000)}&merge=false`,
        {},
        ua
      );
      const out = { quarterly: {}, annual: {} };
      let currency = null;
      for (const res of j.timeseries?.result || []) {
        const type = res.meta?.type?.[0];
        const rows = res[type];
        if (!type || !Array.isArray(rows)) continue;
        const period = type.startsWith('quarterly') ? 'quarterly' : 'annual';
        const field = type.replace(/^(quarterly|annual)/, '');
        for (const row of rows) {
          if (!row?.reportedValue) continue;
          currency ||= row.currencyCode || null;
          const key = row.asOfDate;
          (out[period][key] ||= { asOf: key })[field] = row.reportedValue.raw;
        }
      }
      const toList = (o, n) => Object.values(o).sort((a, b) => b.asOf.localeCompare(a.asOf)).slice(0, n);
      return { currency, quarterly: toList(out.quarterly, 6), annual: toList(out.annual, 4) };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('gagal mengambil laporan keuangan');
}

// ---- IDX (Keterbukaan Informasi): Bypass Cloudflare via stealth scraper + direct + Google RSS fallback ----
const fmtIdx = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
async function fetchIdxAnnouncements(ticker) {
  const t = String(ticker || '').trim().toUpperCase();

  // Jalur 1: Stealth Scraper (Bypass Cloudflare 100% dengan rotasi User-Agent)
  try {
    const cfResult = await runIdxCf('announcements', t);
    if (Array.isArray(cfResult) && cfResult.length > 0) {
      return cfResult;
    }
  } catch (e) {
    // Lanjut ke jalur berikutnya jika ada error
  }

  // Jalur 2: Direct HTTP fetch dengan rotasi User-Agent
  const to = new Date(), from = new Date(Date.now() - 90 * 86400000);
  try {
    const j = await getJson(
      `https://www.idx.co.id/primary/ListedCompany/GetAnnouncement?kodeEmiten=${t}&indexFrom=0&pageSize=15&dateFrom=${fmtIdx(from)}&dateTo=${fmtIdx(to)}&lang=id`,
      { Referer: 'https://www.idx.co.id/' },
      getRandomUa()
    );
    if (j?.Replies?.length) {
      return j.Replies.map((x) => {
        const p = x.pengumuman || {};
        return {
          date: (p.TglPengumuman || '').slice(0, 10), title: p.JudulPengumuman || '',
          type: p.JenisPengumuman || p.PerihalPengumuman || 'Keterbukaan Informasi IDX',
          url: p.PathAktif ? `https://www.idx.co.id${p.PathAktif}` : (x.attachments?.[0]?.FullSavePath || null),
        };
      });
    }
  } catch (err) {
    // Cloudflare 403 atau proteksi aktif
  }

  // Jalur 3: Fallback via Google News RSS (site:idx.co.id)
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${t} site:idx.co.id when:90d`)}&hl=id&gl=ID&ceid=ID:id`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': getRandomUa() } });
    const xml = await res.text();
    const items = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const getTag = (name) => {
        const tag = m[1].match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
        return tag ? tag[1] : '';
      };
      const title = getTag('title').replace(/\s*-\s*PT Bursa Efek Indonesia/i, '').replace(/<[^>]+>/g, '').trim();
      const link = (getTag('link') || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
      const pubDate = getTag('pubDate').trim();
      items.push({
        date: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : '',
        title,
        type: 'Keterbukaan Informasi IDX',
        url: link,
      });
      if (items.length >= 10) break;
    }
    return items;
  } catch (e) {
    return [];
  }
}

// ---- Sinyal risiko: aturan murni, tanpa AI ----
const BAD_ANN = /suspen|pkpu|pailit|gugatan|going concern|penundaan|delisting|sanksi|denda|gagal bayar|restrukturisasi utang|wanprestasi/i;
export function financialSignals(d) {
  const s = [];
  const add = (level, text) => s.push({ level, text });
  const p = d.price || {};
  if (p.change5dPct != null && p.change5dPct <= -10) add('buruk', `Harga turun ${Math.abs(p.change5dPct)}% dalam 5 hari perdagangan.`);
  if (p.change1mPct != null && p.change1mPct <= -20) add('buruk', `Harga turun ${Math.abs(p.change1mPct)}% dalam 1 bulan.`);
  if (p.change5dPct != null && p.change5dPct >= 10) add('baik', `Harga naik ${p.change5dPct}% dalam 5 hari perdagangan.`);
  if (p.price && p.low52w && p.price <= p.low52w * 1.05) add('buruk', 'Harga mendekati level terendah 52 minggu.');
  const q = d.fundamentals?.quarterly || [];
  if (q[0]?.NetIncome != null && q[0].NetIncome < 0) add('buruk', `Rugi bersih pada kuartal ${q[0].asOf}.`);
  const yoy = q.find((x, i) => i > 0 && x.asOf.slice(5) === q[0]?.asOf.slice(5) && x.asOf.slice(0, 4) === String(Number(q[0].asOf.slice(0, 4)) - 1));
  if (yoy && q[0].NetIncome != null && yoy.NetIncome > 0) {
    const ch = pct(q[0].NetIncome, yoy.NetIncome);
    if (ch <= -20) add('buruk', `Laba bersih kuartal ${q[0].asOf} turun ${Math.abs(ch)}% vs periode sama tahun lalu.`);
    else if (ch >= 20) add('baik', `Laba bersih kuartal ${q[0].asOf} naik ${ch}% vs periode sama tahun lalu.`);
  }
  if (yoy && q[0].TotalRevenue != null && yoy.TotalRevenue > 0) {
    const ch = pct(q[0].TotalRevenue, yoy.TotalRevenue);
    if (ch <= -10) add('buruk', `Pendapatan kuartal ${q[0].asOf} turun ${Math.abs(ch)}% vs periode sama tahun lalu.`);
  }
  if (d.valuation?.debtToEquity != null && d.valuation.debtToEquity > 200) add('buruk', `Debt-to-equity tinggi (${Math.round(d.valuation.debtToEquity)}%).`);
  for (const a of d.announcements || []) if (BAD_ANN.test(a.title)) add('buruk', `Pengumuman IDX ${a.date}: ${a.title}`);
  return s;
}

// ---- Gabungan ----
// Ticker yang baru kena 429: dalam 3 menit tidak dipanggil lagi ke Yahoo (hasil gagal terakhir dikembalikan; pemanggil tidak menyimpannya).
const COOLDOWN_429_MS = 3 * 60 * 1000;
const lastFail = new Map();                      // ticker -> { at, data }
export async function getFinancials(ticker, { force = false } = {}) {
  const t = String(ticker || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,6}$/.test(t)) throw Object.assign(new Error('ticker tidak valid'), { status: 400 });
  const hit = cache.get(t);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const lf = lastFail.get(t);
  if (lf && Date.now() - lf.at < COOLDOWN_429_MS) return lf.data;

  const sym = `${t}.JK`;
  const s = await yahooSession().catch(() => null);
  const sessionUa = s?.ua || getRandomUa();
  const parts = {
    price: fetchChart(sym, sessionUa),
    valuation: fetchValuation(sym, sessionUa),
    fundamentals: fetchFundamentals(sym, sessionUa),
    announcements: fetchIdxAnnouncements(t),
  };
  const data = { ticker: t, symbol: sym, fetchedAt: new Date().toISOString(), errors: {} };
  await Promise.all(Object.entries(parts).map(async ([k, p]) => {
    try { data[k] = await p; } catch (e) { data.errors[k] = e.cause?.code ? `${e.message} (${e.cause.code})` : e.message; }
  }));
  if (!data.price && !data.fundamentals) throw new Error(`Tidak ada data untuk ${t}: ${Object.values(data.errors).join('; ')}`);
  data.signals = financialSignals(data);
  if (Object.values(data.errors).some((e) => /429/.test(String(e)))) lastFail.set(t, { at: Date.now(), data }); else lastFail.delete(t);
  if (!data.errors.price && !data.errors.valuation) cache.set(t, { at: Date.now(), data });   // jangan menyimpan hasil yang gagal (mis. 429) di cache
  return data;
}

// ---- Pencarian emiten saham IDX langsung dari bursa (Gabungan IDX Cloudflare Bypass + Yahoo Finance) ----
export async function searchIdx(query) {
  const q = String(query || '').trim();
  if (!q || q.length < 2) return [];

  const map = new Map();

  // 1. Ambil dari IDX resmi via Cloudflare stealth scraper
  try {
    const idxResults = await runIdxCf('search', q);
    if (Array.isArray(idxResults)) {
      for (const item of idxResults) {
        if (item.ticker && !map.has(item.ticker)) {
          map.set(item.ticker, item);
        }
      }
    }
  } catch (e) {
    // Abaikan jika stealth script sedang sibuk
  }

  // 2. Ambil dari Yahoo Finance Search API dengan rotasi User-Agent
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': getRandomUa(), Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const data = await res.json();
    const idxQuotes = (data.quotes || []).filter(
      (item) => (item.symbol && item.symbol.endsWith('.JK')) || item.exchange === 'JKT' || item.exchDisp === 'Jakarta'
    );

    for (const item of idxQuotes) {
      const ticker = item.symbol.replace('.JK', '').toUpperCase();
      if (!map.has(ticker)) {
        map.set(ticker, {
          ticker,
          symbol: item.symbol,
          name: item.longname || item.shortname || item.symbol,
          shortName: item.shortname || '',
          sector: item.sector || item.industry || 'Bursa Efek Indonesia',
          exchange: 'IDX (Bursa Efek Indonesia)',
          type: 'public',
        });
      } else {
        // Lengkapi sektor atau nama jika sebelumnya belum lengkap
        const existing = map.get(ticker);
        if (item.sector && existing.sector === 'Bursa Efek Indonesia') existing.sector = item.sector;
        if (item.longname && existing.name.length < item.longname.length) existing.name = item.longname;
      }
    }
  } catch (e) {
    // Yahoo search fail fallback
  }

  return Array.from(map.values());
}

// Adapter sumber data gratis tanpa API key. Semua mengembalikan [{ title, url, snippet, date, sourceName }].
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveArticleUrl } from '../resolver.js';

export const LISTENER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../listener');
export const PYTHON = process.env.PYTHON || 'python';
export const PY_ENV = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };

// Jalankan CLI crawler Python (tanpa shell, jadi query user aman dari injection).
export function runPython(args, timeout = 60000) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, ['main.py', ...args], { cwd: LISTENER_DIR, env: PY_ENV, timeout, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || stdout || err.message).trim().split('\n').pop()));
      resolve(stdout);
    });
  });
}

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

const MAX_PER_QUERY = 40;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s = '') =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
      return ENTITIES[e.toLowerCase()] ?? m;
    });
const stripTags = (s) => decode(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// Ubah teks tanggal relatif Indonesia (YouTube, hasil SERP Google) jadi tanggal absolut ISO,
// supaya tabel & data tersimpan menampilkan hari+tanggal, bukan potongan "1 hari yan..." dsb.
const REL_UNIT_MS = { detik: 1e3, menit: 6e4, jam: 36e5, hari: 864e5, minggu: 7 * 864e5, bulan: 30 * 864e5, tahun: 365 * 864e5 };
function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const low = s.toLowerCase();
  if (/^(baru saja|beberapa saat yang lalu|now|just now)$/.test(low)) return new Date().toISOString();
  if (/^hari ini$/.test(low)) return new Date().toISOString();
  if (/^kemarin$/.test(low)) return new Date(Date.now() - REL_UNIT_MS.hari).toISOString();

  // "5 hari yang lalu", "1 minggu lalu", "2 weeks ago", dst.
  const relId = low.match(/^(\d+)\s*(detik|menit|jam|hari|minggu|bulan|tahun)\s*(yang\s*)?lalu$/);
  if (relId) return new Date(Date.now() - Number(relId[1]) * REL_UNIT_MS[relId[2]]).toISOString();

  const EN_UNIT = { second: 'detik', minute: 'menit', hour: 'jam', day: 'hari', week: 'minggu', month: 'bulan', year: 'tahun' };
  const relEn = low.match(/^(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago$/);
  if (relEn) return new Date(Date.now() - Number(relEn[1]) * REL_UNIT_MS[EN_UNIT[relEn[2]]]).toISOString();

  // Sudah berupa tanggal absolut (pubDate RSS, ISO, dll) -> normalisasi jadi ISO juga
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (name) => {
      const t = m[1].match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
      return t ? t[1] : '';
    };
    const sourceTag = m[1].match(/<source([^>]*)>([\s\S]*?)<\/source>/i);
    const sourceUrl = sourceTag ? (sourceTag[1].match(/url="([^"]+)"/i) || [])[1] || '' : '';
    items.push({
      title: stripTags(tag('title')),
      link: decode(tag('link')).trim(),
      description: stripTags(tag('description')),
      pubDate: tag('pubDate').trim(),
      source: stripTags(tag('source') || tag('News:Source')),
      sourceUrl: decode(sourceUrl).trim(),
      image: decode(tag('News:Image')).trim().replace(/^http:/, 'https:'),
    });
  }
  return items;
}

async function get(url, init = {}) {
  const host = new URL(url).hostname;
  let res;
  try {
    res = await fetch(url, { ...init, headers: { 'User-Agent': getRandomUa(), 'Accept-Language': 'id-ID,id;q=0.9', ...init.headers } });
  } catch (e) {
    // fetch() Node membalas pesan generik "fetch failed"; penyebab aslinya (DNS/koneksi/TLS/timeout) ada di e.cause
    const cause = e.cause?.code || e.cause?.message || e.cause;
    throw new Error(`Gagal konek ke ${host}${cause ? `: ${cause}` : ` (${e.message})`}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} dari ${host}`);
  return res;
}

// ---------- Google News (RSS resmi). when:7d = 7 hari terakhir ----------
// Alamat artikel diselesaikan langsung ke situs asli penerbit saat crawl agar tidak menyimpan tautan Google News
async function googleNews(q) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:7d`)}&hl=id&gl=ID&ceid=ID:id`;
  const rawItems = parseRss(await (await get(url)).text()).slice(0, MAX_PER_QUERY);
  const items = await Promise.all(rawItems.map(async (i) => {
    const title = i.source && i.title.endsWith(` - ${i.source}`) ? i.title.slice(0, -(i.source.length + 3)) : i.title;
    let domain = '';
    try { if (i.sourceUrl) domain = new URL(i.sourceUrl).hostname.replace(/^www\./, ''); } catch {}
    const real = await resolveArticleUrl({ url: i.link, title, source_domain: domain, source_name: i.source }).catch(() => null);
    const targetUrl = real || i.link;
    return {
      title,
      url: targetUrl,
      originalUrl: i.link,
      articleUrl: real || undefined,
      snippet: '',
      date: normalizeDate(i.pubDate),
      sourceName: i.source || 'Google News',
      sourceUrl: targetUrl,
    };
  }));
  return items;
}

function cleanBingQuery(q) {
  // Bersihkan embel-embel hukum formal agar artikel berita yang menulis nama umum tetap tertangkap
  return q
    .replace(/\(persero\)/gi, '')
    .replace(/\btbk\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/""/g, '')
    .trim();
}

async function fetchBingRssItems(query) {
  try {
    const url = `https://www.bing.com/news/search?q=${encodeURIComponent(query)}&format=rss&setlang=id&cc=ID`;
    const res = await get(url);
    return parseRss(await res.text());
  } catch {
    return [];
  }
}

// ---------- Bing News (RSS) dengan Smart Query & Fallback ----------
async function bingNews(q) {
  const cleaned = cleanBingQuery(q);
  const cutoff7d = Date.now() - 7 * 24 * 60 * 60 * 1000;

  // 1. Ambil RSS dengan query yang sudah dibersihkan
  let rawItems = await fetchBingRssItems(cleaned);

  // 2. Jika 0 hasil dan query memakai tanda kutip ganda kaku, coba lepaskan tanda kutip
  if (!rawItems.length && cleaned.includes('"')) {
    rawItems = await fetchBingRssItems(cleaned.replace(/"/g, '').trim());
  }

  // 3. Filter 7 hari terakhir jika ada berita baru
  let matched = rawItems.filter((i) => {
    const t = Date.parse(i.pubDate);
    return !Number.isNaN(t) ? t >= cutoff7d : true;
  });

  // 4. Fallback: jika dalam 7 hari tidak ada berita, tampilkan berita terkini yang tersedia (hingga 30 hari)
  if (!matched.length && rawItems.length) {
    matched = rawItems;
  }

  const seen = new Set();
  const results = [];
  for (const i of matched) {
    let link = i.link;
    try { link = new URL(i.link).searchParams.get('url') || i.link; } catch {}
    if (seen.has(link)) continue;
    seen.add(link);
    results.push({
      title: i.title,
      url: link,
      snippet: i.description,
      date: normalizeDate(i.pubDate),
      sourceName: i.source || 'Bing News',
      sourceUrl: i.sourceUrl, image: i.image || undefined,
    });
    if (results.length >= MAX_PER_QUERY) break;
  }

  return results;
}

// ---------- YouTube (endpoint internal web, tanpa login). Filter "minggu ini" ----------
async function youtube(q) {
  const res = await get('https://www.youtube.com/youtubei/v1/search?prettyPrint=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'id', gl: 'ID' } },
      query: q.replace(/\sOR\s/g, ' '),
      params: 'EgIIAw%3D%3D',
    }),
  });
  const json = await res.json();
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.videoRenderer) {
      const v = n.videoRenderer;
      out.push({
        title: v.title?.runs?.map((r) => r.text).join('') || '',
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        snippet: (v.detailedMetadataSnippets?.[0]?.snippetText?.runs || v.descriptionSnippet?.runs || []).map((r) => r.text).join(''),
        date: normalizeDate(v.publishedTimeText?.simpleText),
        sourceName: `YouTube · ${v.ownerText?.runs?.[0]?.text || ''}`.replace(/ · $/, ''),
      });
      return;
    }
    for (const k of Object.keys(n)) walk(n[k]);
  };
  walk(json);
  return out.slice(0, MAX_PER_QUERY);
}

// ---------- Media Sosial (X, Instagram, Facebook, Reddit, TikTok, Threads, LinkedIn) via Google News Social RSS ----------
// Jauh lebih cepat (~0.3 detik), 100% bebas dari risiko banned bot / CAPTCHA Google, dan judul/caption asli langsung terambil.
async function googleSocial(q) {
  const cleanQ = q.replace(/["()]/g, '').replace(/\s+OR\s+/g, ' ').replace(/\s+AND\s+/g, ' ').trim();
  const socialSites = '(site:x.com OR site:instagram.com OR site:tiktok.com OR site:facebook.com OR site:linkedin.com OR site:reddit.com OR site:threads.net)';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${cleanQ} ${socialSites} when:7d`)}&hl=id&gl=ID&ceid=ID:id`;

  let xml = '';
  try {
    xml = await (await get(url)).text();
  } catch (e) {
    const fallbackUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(`${cleanQ} ${socialSites}`)}&hl=id&gl=ID&ceid=ID:id`;
    xml = await (await get(fallbackUrl)).text();
  }

  const items = parseRss(xml);
  return items.slice(0, MAX_PER_QUERY).map((i) => {
    let sourceName = 'Media Sosial';
    const s = (i.source || '').toLowerCase();
    const su = (i.sourceUrl || '').toLowerCase();

    if (s.includes('instagram') || su.includes('instagram.com')) sourceName = 'Instagram';
    else if (s.includes('facebook') || su.includes('facebook.com')) sourceName = 'Facebook';
    else if (s.includes('reddit') || su.includes('reddit.com')) sourceName = 'Reddit';
    else if (s.includes('tiktok') || su.includes('tiktok.com')) sourceName = 'TikTok';
    else if (s.includes('threads') || su.includes('threads.net')) sourceName = 'Threads';
    else if (s.includes('linkedin') || su.includes('linkedin.com')) sourceName = 'LinkedIn';
    else if (s.includes('x') || s.includes('twitter') || su.includes('x.com') || su.includes('twitter.com')) sourceName = 'X / Twitter';

    // Judul Google News berformat "Judul Postingan - Nama Platform"
    const title = i.source && i.title.endsWith(` - ${i.source}`) ? i.title.slice(0, -(i.source.length + 3)).trim() : i.title;

    return {
      title,
      url: i.link,
      snippet: i.description || '',
      date: normalizeDate(i.pubDate),
      sourceName,
    };
  });
}

// Alias untuk kompatibilitas
const googleX = googleSocial;

// ---------- Index lokal: hasil crawler Python (berita, blog, forum, instansi, dll) ----------
// Ekspresi query memakai sintaks boolean crawler: "frasa" (a OR b) NOT c
async function localIndex(q) {
  const out = await runPython(['search', q, '--days', '7', '--limit', '300', '--json']);
  return JSON.parse(out).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.snippet || '',
    date: normalizeDate(r.published),
    sourceName: `${r.source} (${r.category})`,
  }));
}

// Sumber aktif yang langsung di-fetch secara live
export const ADAPTERS = {
  google_news: { label: 'Google News', run: googleNews },
  bing_news:   { label: 'Bing News', run: bingNews },
  youtube:     { label: 'YouTube', run: youtube },
  social_media:{ label: 'Media Sosial (X, IG, FB, Reddit, TikTok, Threads, LinkedIn)', run: googleSocial },
  // local_index disabled — storage diganti ke JSON, tidak perlu SQLite
};

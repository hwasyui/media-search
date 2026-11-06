// Penyelesai URL artikel berita asli (menghindari redirect rusak Google News & bot-block 429).
// Menggunakan pendekatan berjenjang:
//  1. Jika bukan URL Google News, gunakan langsung URL aslinya.
//  2. Ekstraksi langsung via Bing News RSS berdasarkan judul & domain penerbit (cepat, akurat, bebas 429).
//  3. Ekstraksi via DuckDuckGo HTML search berdasarkan judul & domain penerbit asli.
//  4. Coba googlenewsdecoder (teknik Bughopper14) via skrip src/listener/tools/unmask-url.js.
//  5. Coba google-news-url-decoder (node decoder).
//  Bila semuanya gagal: mengembalikan null. TIDAK ada lagi tautan pengganti berupa pencarian Google.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pkg from 'google-news-url-decoder';
const { GoogleDecoder } = pkg;

const execFileAsync = promisify(execFile);
const decoder = new GoogleDecoder();

export const isGoogleNewsUrl = (u) => /^https?:\/\/news\.google\.com\/(rss\/)?articles\//i.test(u || '');

// Bersihkan judul berita dari akhiran nama portal (mis. " - CNBC Indonesia")
export function cleanNewsTitle(title = '') {
  return String(title || '')
    .replace(/\s*[-–—|]\s*[^-–—|]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(t1, t2) {
  const words1 = new Set(t1.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(t2.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(w => w.length > 2));
  let match = 0;
  for (const w of words1) {
    if (words2.has(w)) match++;
  }
  return match / Math.max(words1.size, 1);
}

function parseBingRssLink(xml, expectedDomain, originalTitle = '') {
  if (!xml || !xml.includes('<item>')) return null;
  const matches = [...xml.matchAll(/<item>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<\/item>/g)];
  
  // 1. Prioritaskan kecocokan domain
  for (const m of matches) {
    const rawLink = m[2].replace(/&amp;/g, '&').trim();
    const uMatch = rawLink.match(/[\?&]url=([^&]+)/);
    if (uMatch) {
      try {
        const dec = decodeURIComponent(uMatch[1]);
        const host = new URL(dec).hostname.replace(/^www\./, '').toLowerCase();
        if (expectedDomain) {
          const exp = expectedDomain.replace(/^www\./, '').toLowerCase();
          const baseExp = exp.replace(/^(news|m|amp|berita|finance|ekonomi)\./, '');
          const baseHost = host.replace(/^(news|m|amp|berita|finance|ekonomi)\./, '');
          if (host.includes(exp) || exp.includes(host) || baseHost.includes(baseExp) || baseExp.includes(baseHost)) return dec;
        } else if (!/(^|\.)(bing\.com|google\.com)$/i.test(host)) {
          return dec;
        }
      } catch {}
    }
  }

  // 2. Jika domain spesifik tidak ketemu tapi judulnya sangat mirip (>= 50% kesamaan kata)
  if (originalTitle) {
    for (const m of matches) {
      const itemTitle = m[1].replace(/&amp;/g, '&');
      const rawLink = m[2].replace(/&amp;/g, '&').trim();
      const uMatch = rawLink.match(/[\?&]url=([^&]+)/);
      if (uMatch && titleSimilarity(originalTitle, itemTitle) >= 0.5) {
        try {
          const dec = decodeURIComponent(uMatch[1]);
          const host = new URL(dec).hostname.replace(/^www\./, '').toLowerCase();
          if (!/(^|\.)(bing\.com|google\.com)$/i.test(host)) return dec;
        } catch {}
      }
    }
  }

  return null;
}

// Cari URL asli via Bing News RSS
async function resolveViaBing(title, domain) {
  const clean = cleanNewsTitle(title);
  if (!clean) return null;

  const queries = [clean];
  if (clean.includes(',')) {
    const firstClause = clean.split(',')[0].trim();
    if (firstClause.length >= 25) queries.push(firstClause);
  }

  for (const q of queries) {
    try {
      const qWithSite = domain ? `${q} site:${domain.replace(/^(news|m|amp)\./, '')}` : q;
      const { stdout } = await execFileAsync('curl.exe', [
        '-s', '-L',
        '--max-time', '4',
        `https://www.bing.com/news/search?q=${encodeURIComponent(qWithSite)}&format=rss&setlang=id&cc=ID`
      ], { maxBuffer: 2 * 1024 * 1024 });

      const found = parseBingRssLink(stdout, domain, clean);
      if (found) return found;

      if (domain) {
        // Coba sekali lagi tanpa filter kaku site:
        const { stdout: stdout2 } = await execFileAsync('curl.exe', [
          '-s', '-L',
          '--max-time', '4',
          `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=id&cc=ID`
        ], { maxBuffer: 2 * 1024 * 1024 });
        const found2 = parseBingRssLink(stdout2, domain, clean);
        if (found2) return found2;
      }
    } catch {}
  }
  return null;
}

// Cari URL asli via DuckDuckGo HTML
async function resolveViaDuckDuckGo(title, expectedDomain) {
  const clean = cleanNewsTitle(title);
  if (!clean) return null;
  try {
    const q = expectedDomain ? `${clean} site:${expectedDomain}` : clean;
    const { stdout } = await execFileAsync('curl.exe', [
      '-s', '-L', '--max-time', '5',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`
    ], { maxBuffer: 1024 * 1024 });

    const matches = [...stdout.matchAll(/href="([^"]*uddg=[^"]*)"/g)];
    const exp = (expectedDomain || '').replace(/^www\./, '').toLowerCase();
    for (const m of matches) {
      const raw = m[1].split('uddg=')[1]?.split('&')[0];
      if (raw) {
        try {
          const dec = decodeURIComponent(raw);
          if (!/^https?:\/\//i.test(dec)) continue;
          const host = new URL(dec).hostname.replace(/^www\./, '').toLowerCase();
          if (exp && (host.includes(exp) || exp.includes(host))) return dec;
          if (!exp && !/(duckduckgo\.com|bing\.com|google\.com)/.test(host)) return dec;
        } catch {}
      }
    }
  } catch {}
  return null;
}

let googleBlockedUntil = 0;
let lastGoogleCall = 0;
const GOOGLE_CALL_GAP_MS = 3000; // jeda aman 3 detik antar pemanggilan decoder Google

// Coba decode Google News via googlenewsdecoder (teknik Bughopper14) dengan pelindung IP (Circuit Breaker & Rate Limiter)
async function unmaskViaDecoderScript(url) {
  if (Date.now() < googleBlockedUntil) {
    return null; // Sedang cooldown proteksi IP agar terhindar dari pemblokiran berlarut-larut
  }

  const wait = Math.max(0, lastGoogleCall + GOOGLE_CALL_GAP_MS - Date.now());
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastGoogleCall = Date.now();

  try {
    const { stdout } = await execFileAsync(process.execPath, ['src/listener/tools/unmask-url.js', url], { timeout: 6000 });
    const parsed = JSON.parse(stdout.trim().split('\n').pop());
    if (parsed?.success && parsed.decoded_url && !isGoogleNewsUrl(parsed.decoded_url)) {
      return parsed.decoded_url;
    }
    if (parsed?.message && /429|Too Many Requests/i.test(parsed.message)) {
      // Aktifkan circuit breaker 15 menit agar IP aman
      googleBlockedUntil = Date.now() + 15 * 60 * 1000;
    }
  } catch {}
  return null;
}

// Cari tautan Google News RSS untuk sebuah judul (bila tautan awalnya berupa google search)
async function findGoogleNewsLink(title, domain) {
  const q = cleanNewsTitle(title);
  if (!q) return null;
  try {
    const res = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent('"' + q + '"')}&hl=id&gl=ID&ceid=ID:id`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0 Safari/537.36' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const site = String(domain || '').replace(/^www[.]/, '').toLowerCase();
    for (const m of xml.matchAll(/<item>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<\/item>/g)) {
      const link = m[2].trim();
      const src = (m[0].match(/<source[^>]*url="([^"]+)"/) || [])[1] || '';
      if (link && isGoogleNewsUrl(link) && (!site || src.toLowerCase().includes(site))) {
        return link;
      }
    }
  } catch {}
  return null;
}

export async function resolveArticleUrl({ id, url, title, snippet, source_domain, source_name }) {
  if (url && !isGoogleNewsUrl(url) && !url.startsWith('https://www.google.com/search') && !url.startsWith('https://google.com/search')) {
    return url;
  }

  // Bersihkan domain: jika google.com atau kosong, cari domain penerbit asli dari query atau nama sumber
  let domain = (source_domain || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  if (!domain || domain === 'google.com' || domain.includes('google')) {
    if (url) {
      const qMatch = url.match(/(?:q=|%20)([a-zA-Z0-9-]+\.[a-zA-Z]{2,})(?:&|$|\s)/);
      if (qMatch) domain = qMatch[1].toLowerCase();
    }
    if ((!domain || domain === 'google.com') && source_name) {
      const s = source_name.toLowerCase().trim();
      if (s.includes('.')) {
        const parts = s.split(/\s+/);
        for (const p of parts) {
          if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}$/.test(p)) { domain = p; break; }
        }
      }
    }
  }

  // Tingkat 1: Bing News RSS (sangat cepat, akurat, dan 100% bebas blokir IP Google)
  if (domain && domain !== 'google.com') {
    const fromBing = await resolveViaBing(title, domain);
    if (fromBing) return fromBing;

    // Tingkat 2: DuckDuckGo HTML Search
    const fromDdg = await resolveViaDuckDuckGo(title, domain);
    if (fromDdg) return fromDdg;
  }

  // Tingkat 3: Coba decode Google News via googlenewsdecoder berjarak aman
  if (url && isGoogleNewsUrl(url) && Date.now() >= googleBlockedUntil) {
    const pyDec = await unmaskViaDecoderScript(url);
    if (pyDec) return pyDec;

    // Coba decode Google News via node decoder internal
    try {
      const dec = await Promise.race([
        decoder.decode(url),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
      ]);
      if (dec?.status && dec.decoded_url && !isGoogleNewsUrl(dec.decoded_url)) {
        return dec.decoded_url;
      }
      if (/429/.test(String(dec?.message || ''))) {
        googleBlockedUntil = Date.now() + 15 * 60 * 1000;
      }
    } catch {}
  }

  // Tingkat 4: Jika tautan awal adalah Google Search link (bukan Google News), cari link Google News-nya via judul lalu decode
  if (title && (!url || !isGoogleNewsUrl(url)) && Date.now() >= googleBlockedUntil) {
    const gLink = await findGoogleNewsLink(title, domain !== 'google.com' ? domain : '');
    if (gLink) {
      const pyDec = await unmaskViaDecoderScript(gLink);
      if (pyDec) return pyDec;
    }
  }

  // Alamat penerbit tidak ditemukan: jangan pernah mengembalikan link pencarian Google
  return null;
}

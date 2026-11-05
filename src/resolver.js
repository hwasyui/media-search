// Penyelesai URL artikel berita asli (menghindari redirect rusak Google News & bot-block 429).
// Menggunakan pendekatan berjenjang:
//  1. Jika bukan URL Google News, gunakan langsung URL aslinya.
//  2. Ekstraksi langsung via Bing News RSS berdasarkan judul & domain penerbit (cepat, akurat, bebas 429).
//  3. Coba google-news-url-decoder bila ada peluang respon cepat (<1.5 detik).
//  4. Fallback pencarian Google Search bersih yang dijamin selalu terbuka di browser tanpa halaman error/sorry.

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

function parseBingRssLink(xml, expectedDomain) {
  if (!xml || !xml.includes('<item>')) return null;
  const matches = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]+)<\/link>[\s\S]*?<\/item>/g)];
  for (const m of matches) {
    const rawLink = m[1].replace(/&amp;/g, '&').trim();
    const uMatch = rawLink.match(/[\?&]url=([^&]+)/);
    if (uMatch) {
      try {
        const dec = decodeURIComponent(uMatch[1]);
        const host = new URL(dec).hostname.replace(/^www\./, '').toLowerCase();
        if (expectedDomain) {
          const exp = expectedDomain.replace(/^www\./, '').toLowerCase();
          if (host.includes(exp) || exp.includes(host)) return dec;
        } else if (!/(^|\.)(bing\.com|google\.com)$/i.test(host)) {
          return dec;
        }
      } catch {}
    }
  }
  return null;
}

// Cari URL asli via Bing News RSS
async function resolveViaBing(title, domain) {
  const clean = cleanNewsTitle(title);
  if (!clean) return null;

  try {
    const qWithSite = domain ? `${clean} site:${domain}` : clean;
    const { stdout } = await execFileAsync('curl.exe', [
      '-s', '-L',
      '--max-time', '4',
      `https://www.bing.com/news/search?q=${encodeURIComponent(qWithSite)}&format=rss&setlang=id&cc=ID`
    ], { maxBuffer: 2 * 1024 * 1024 });

    const found = parseBingRssLink(stdout, domain);
    if (found) return found;

    if (domain) {
      // Coba sekali lagi tanpa filter kaku site:
      const { stdout: stdout2 } = await execFileAsync('curl.exe', [
        '-s', '-L',
        '--max-time', '4',
        `https://www.bing.com/news/search?q=${encodeURIComponent(clean)}&format=rss&setlang=id&cc=ID`
      ], { maxBuffer: 2 * 1024 * 1024 });
      return parseBingRssLink(stdout2, domain);
    }
  } catch {}
  return null;
}

export async function resolveArticleUrl({ id, url, title, snippet, source_domain, source_name }) {
  if (url && !isGoogleNewsUrl(url)) {
    return url;
  }

  const domain = (source_domain || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];

  // Tingkat 1: Bing News RSS
  const fromBing = await resolveViaBing(title, domain);
  if (fromBing) return fromBing;

  // Tingkat 2: Coba decode Google News dengan batas waktu ketat
  if (url && isGoogleNewsUrl(url)) {
    try {
      const dec = await Promise.race([
        decoder.decode(url),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 1500)),
      ]);
      if (dec?.status && dec.decoded_url && !isGoogleNewsUrl(dec.decoded_url)) {
        return dec.decoded_url;
      }
    } catch {}
  }

  // Tingkat 3: Fallback ke pencarian Google Search aman
  const clean = cleanNewsTitle(title) || title || '';
  const queryStr = `${clean} ${domain || source_name || ''}`.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(queryStr)}`;
}


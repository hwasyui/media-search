// Ekstraksi konten lengkap (full article body & social media post caption) secara aman tanpa bot-block.
//   - Google News RSS: Decode redirect CBMi... ke URL asli penerbit
//   - Berita / Web: Ekstraksi paragraf semantik (<article>, <p>) & meta description, fallback curl native untuk bypass Cloudflare WAF
//   - YouTube: Endpoint resmi oEmbed untuk author kanal & thumbnail + snippet/deskripsi
//   - Instagram & Threads: Link preview crawler (facebookexternalhit) untuk mengambil caption utuh tanpa login-wall
//   - TikTok & X/Twitter: Endpoint resmi oEmbed untuk mendapatkan caption & nama akun
//   - Concurrency limiter & in-memory cache agar cepat dan tidak membebani network
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from 'google-news-url-decoder';
const { GoogleDecoder } = pkg;
import { getRandomUa } from '../risk/financial.js';
import { isGoogleNewsUrl, resolveArticleUrl } from '../links/resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAYWRIGHT_SCRIPT = path.join(__dirname, '../listener/tools/fetch-playwright.js');

const execFileAsync = promisify(execFile);
const decoder = new GoogleDecoder();
const CACHE_MAX = 5000;
const contentCache = new Map();

function getCached(url) {
  return contentCache.get(url);
}

function setCache(url, data) {
  if (contentCache.size >= CACHE_MAX) {
    const firstKey = contentCache.keys().next().value;
    contentCache.delete(firstKey);
  }
  contentCache.set(url, data);
}

function decodeHtmlEntities(str = '') {
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#x201c;|&#x201d;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#x2018;|&#x2019;|&lsquo;|&rsquo;/gi, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&hellip;/g, '…')
    .replace(/&#x[0-9a-f]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const escHtml = (t = '') => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HTML_MAX = 200_000;

// Kebalikan parasToHtml: content_html (hanya <p> ter-escape) -> teks polos, satu paragraf per baris. Dipakai AI & asisten.
export function htmlToText(html) {
  return String(html || '')
    .replace(/<\/p>\s*/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n').trim();
}
export const parasToHtml = (paras) => paras.map((t) => '<p>' + escHtml(t) + '</p>').join('\n').slice(0, HTML_MAX);

function isBlockedHtml(html) {
  if (!html || html.length < 300) return true;
  return html.includes('Just a moment...') ||
         html.includes('challenge-running') ||
         html.includes('Enable JavaScript and cookies') ||
         html.includes('Your request was blocked') ||
         html.includes('Access Denied') ||
         html.includes('403 Forbidden');
}

// Unduh via native curl.exe untuk situs yang dilindungi Cloudflare / TLS fingerprinting
async function fetchWithCurl(url) {
  try {
    const { stdout } = await execFileAsync('curl.exe', [
      '-s', '-L',
      '--max-time', '8',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '-H', 'Accept-Language: id-ID,id;q=0.9,en-US;q=0.8',
      url,
    ], { maxBuffer: 5 * 1024 * 1024 });
    return stdout;
  } catch {
    return null;
  }
}

// Unduh via headless Playwright browser jika situs memblokir dengan Cloudflare Managed Challenge (mis. Bisnis.com)
async function fetchWithBrowser(url) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [PLAYWRIGHT_SCRIPT, url], {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 20000,
    });
    return stdout;
  } catch {
    return null;
  }
}

// Unduh halaman artikel. Percobaan 1: header browser (UA rotasi). Bila ditolak/timeout: percobaan 2 sebagai crawler pratinjau tautan
// (facebookexternalhit). Bila tetap 403 / Cloudflare challenge: percobaan 3 native curl, lalu percobaan 4 headless Playwright.
const PREVIEW_UA = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.html)';
async function fetchHtml(url) {
  for (const ua of [getRandomUa(), PREVIEW_UA]) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': ua, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8', ...(ua === PREVIEW_UA ? {} : { Referer: 'https://news.google.com/' }) },
        signal: AbortSignal.timeout(6000), redirect: 'follow',
      });
      if (!res.ok || !/html|xml/i.test(res.headers.get('content-type') || 'text/html')) continue;
      const html = (await res.text()).slice(0, 1_500_000);
      if (isBlockedHtml(html)) continue;
      return { html, url: res.url || url };
    } catch { /* coba UA berikutnya */ }
  }

  // Percobaan 3: Native curl fallback jika node fetch di-challenge oleh Cloudflare
  try {
    const curlHtml = await fetchWithCurl(url);
    if (curlHtml && !isBlockedHtml(curlHtml)) {
      return { html: curlHtml.slice(0, 1_500_000), url };
    }
  } catch {}

  // Percobaan 4: Headless Playwright untuk memecahkan Cloudflare Managed Challenge
  try {
    const browserHtml = await fetchWithBrowser(url);
    if (browserHtml && !isBlockedHtml(browserHtml)) {
      return { html: browserHtml.slice(0, 1_500_000), url };
    }
  } catch {}

  return null;
}

// Gambar pratinjau halaman, urutan seperti kartu pratinjau tautan: og:image, twitter:image, <link rel=image_src>, lalu gambar di JSON-LD.
const META_IMG = /<meta[^>]+(?:property|name|itemprop)=["'](?:og:image(?::secure_url|:url)?|twitter:image(?::src)?|image)["'][^>]*>/gi;
export function pickImage(html, baseUrl) {
  const cands = [];
  for (const tag of html.match(META_IMG) || []) { const c = tag.match(/content=["']([^"']+)["']/i)?.[1]; if (c) cands.push(c); }
  const lk = html.match(/<link[^>]+rel=["']image_src["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1];
  if (lk) cands.push(lk);
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      for (const n of Array.isArray(j) ? j : j['@graph'] || [j]) {
        const im = n?.image;
        const u = typeof im === 'string' ? im : Array.isArray(im) ? (typeof im[0] === 'string' ? im[0] : im[0]?.url) : im?.url;
        if (u) cands.push(u);
      }
    } catch { /* JSON-LD rusak: abaikan */ }
  }
  for (const c of cands) {
    try { const u = new URL(c.replace(/&amp;/g, '&'), baseUrl); if (/^https?:$/.test(u.protocol)) return u.toString(); } catch { /* kandidat berikutnya */ }
  }
  return null;
}

// Ekstraksi paragraf dari payload Next.js SSR (__NEXT_DATA__) bila tersedia
function extractNextDataParas(html) {
  const match = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const pageProps = parsed?.props?.pageProps;
  if (!pageProps || typeof pageProps !== 'object') return [];

  const candidates = [];
  function cleanPara(p) {
    if (typeof p !== 'string') return '';
    return p.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function addCandidate(raw) {
    if (!raw) return;
    let paras = [];
    if (typeof raw === 'string') {
      if (raw.length < 200) return;
      if (/<(?:p|br|div)\b/i.test(raw)) {
        const formatted = ('<p>' + raw + '</p>')
          .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '</p><p>')
          .replace(/<p\b([^>]*)>/gi, '</p><p$1>')
          .replace(/<\/p>/gi, '</p>\n');
        const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
        let m;
        while ((m = pRegex.exec(formatted)) !== null) {
          const cp = cleanPara(m[1]);
          if (cp.length >= 35 && !/^(baca juga|simak juga|baca disini|baca artikel|advertisement|halaman selanjutnya)/i.test(cp)) {
            paras.push(cp);
          }
        }
      } else {
        paras = raw
          .split(/\r?\n\s*\r?\n|\r?\n/)
          .map(cleanPara)
          .filter(p => p.length >= 35 && !/^(baca juga|simak juga|baca disini|baca artikel|advertisement|halaman selanjutnya)/i.test(p));
      }
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item === 'string') {
          const cp = cleanPara(item);
          if (cp.length >= 35) paras.push(cp);
        } else if (item && typeof item === 'object') {
          const val = item.value || item.text || item.content || item.body;
          if (typeof val === 'string') {
            const cp = cleanPara(val);
            if (cp.length >= 35) paras.push(cp);
          }
        }
      }
    }

    if (paras.length >= 2) {
      candidates.push(paras);
    }
  }

  const KEY_REGEX = /^(articleBody|content|body|content_html|detail|article_content|article_body|story|text|full_content|post_content|description|isi_berita|news_content)$/i;

  function walk(node, depth = 0) {
    if (!node || depth > 6 || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, val] of Object.entries(node)) {
      if (KEY_REGEX.test(key)) {
        addCandidate(val);
      }
      if (val && typeof val === 'object') {
        walk(val, depth + 1);
      }
    }
  }

  walk(pageProps);
  if (!candidates.length) return [];
  candidates.sort((a, b) => b.join(' ').length - a.join(' ').length);
  return candidates[0];
}

// Ekstraksi paragraf bersih dari halaman artikel berita
function extractArticleBody(html) {
  // 1. Cek kandidat dari JSON-LD articleBody
  let jsonLdParas = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(m[1]);
      const items = Array.isArray(parsed) ? parsed : parsed['@graph'] || [parsed];
      for (const item of items) {
        if (item && typeof item === 'object' && typeof item.articleBody === 'string') {
          const body = item.articleBody.trim();
          // Jika tidak berakhiran elipsis (… atau ...) dan cukup panjang
          if (body.length >= 300 && !/[…\.]+\s*$/.test(body)) {
            const raw = body
              .split(/\n\s*\n|\r\n\r\n|\n/)
              .map(p => p.trim())
              .filter(p => p.length >= 25 && !/^(baca juga|simak juga|baca artikel|halaman selanjutnya|advertisement)/i.test(p));
            if (raw.length >= 2 && raw.join(' ').length > jsonLdParas.join(' ').length) {
              jsonLdParas = raw;
            }
          }
        }
      }
    } catch { /* JSON-LD rusak: abaikan */ }
  }

  // 2. Cek kandidat dari payload SSR Next.js (__NEXT_DATA__)
  const nextDataParas = extractNextDataParas(html);

  // 3. Ekstraksi dari DOM HTML dengan normalisasi tag
  let cleanHtml = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<footer\b[^>]*class=["'][^"']*(?:site|global|footer)[^"']*["'][^>]*>[\s\S]*?<\/footer>/gi, ' ');

  const ogDesc = cleanHtml.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                 cleanHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || '';

  // Helper untuk mengekstrak paragraf dari blok HTML
  function getParagraphsFromScope(scopeHtml) {
    const formatted = ('<p>' + (scopeHtml || '') + '</p>')
      .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '</p><p>')
      .replace(/<p\b([^>]*)>/gi, '</p><p$1>')
      .replace(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/gi, '</p><p>$1</p><p>')
      .replace(/<div\b[^>]*style=["'][^"']*text-align:\s*(?:justify|left)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi, '</p><p>$1</p><p>')
      .replace(/<\/p>/gi, '</p>\n');
    const res = [];
    const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let match;
    while ((match = pRegex.exec(formatted)) !== null) {
      const rawP = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (rawP.length >= 35 &&
          !/^(baca juga|simak juga|baca disini|baca artikel|pilihan editor|artikel berlanjut setelah iklan|advertisement|halaman selanjutnya|halaman:|scroll to continue|redaksi|editor:|penulis:|kontributor:|\*\s*executive brief|cek berita dan artikel|download aplikasi|nyaman tanpa iklan|langganan bisnispro|pewarta\s*:|copyright\s*&copy;)/i.test(rawP)) {
        res.push(rawP);
      }
    }
    return res;
  }

  // Ekstraksi paragraf dari kontainer & global DOM
  const globalParas = getParagraphsFromScope(cleanHtml);
  let paras = globalParas;

  // Bandingkan kandidat: pilih yang paling utuh/banyak teksnya
  if (jsonLdParas.length >= 2 && jsonLdParas.join(' ').length > paras.join(' ').length) {
    paras = jsonLdParas;
  }
  if (nextDataParas.length >= 2 && nextDataParas.join(' ').length > paras.join(' ').length) {
    paras = nextDataParas;
  }

  const fullText = paras.join('\n\n').slice(0, 3000);
  const desc = decodeHtmlEntities(ogDesc);
  // html = badan artikel utuh (semua paragraf, tanpa batas 3000 huruf) dalam <p> bersih untuk disimpan ke DB
  const bodyParas = paras.map(decodeHtmlEntities);
  return {
    description: desc,
    content: fullText ? decodeHtmlEntities(fullText) : desc,
    html: bodyParas.length ? parasToHtml(bodyParas) : desc ? parasToHtml([desc]) : '',
  };
}

export async function extractContentFromUrl(rawUrl, { title: fallbackTitle = '', snippet: fallbackSnippet = '' } = {}) {
  if (!rawUrl) return null;
  const cached = getCached(rawUrl);
  if (cached) return cached;

  let targetUrl = rawUrl;

  // 1. Selesaikan Google News redirect ke URL asli penerbit
  if (isGoogleNewsUrl(rawUrl)) {
    try {
      const real = await resolveArticleUrl({ url: rawUrl, title: fallbackTitle, snippet: fallbackSnippet });
      if (real && !isGoogleNewsUrl(real)) {
        targetUrl = real;
      }
    } catch {}
  }

  let host = '';
  try { host = new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { return null; }

  let fullContent = '';
  let snippet = '';
  let author = '';
  let contentHtml = '';
  let image = null;

  // 2. Ekstraksi spesifik platform
  try {
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      const vid = targetUrl.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
      let ytTitle = fallbackTitle || '';
      let ytDesc = '';

      if (vid) {
        // 1. YouTube Innertube Player API (internal endpoint tanpa login, mengembalikan judul, author, dan DESKRIPSI LENGKAP)
        try {
          const pRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              context: { client: { clientName: 'WEB', clientVersion: '2.20250101.00.00', hl: 'id', gl: 'ID' } },
              videoId: vid,
            }),
            signal: AbortSignal.timeout(6000),
          });
          if (pRes.ok) {
            const pj = await pRes.json();
            if (pj.videoDetails) {
              if (pj.videoDetails.title) ytTitle = pj.videoDetails.title;
              if (pj.videoDetails.author) author = pj.videoDetails.author;
              ytDesc = pj.videoDetails.shortDescription || '';
              if (pj.videoDetails.thumbnail?.thumbnails?.length) {
                const thumbs = pj.videoDetails.thumbnail.thumbnails;
                image = thumbs[thumbs.length - 1]?.url || image;
              }
            }
          }
        } catch {}

        if (!image) {
          image = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
        }
      }

      // 2. Jika author atau title belum diperoleh, coba oEmbed resmi
      if (!author || !ytTitle) {
        try {
          const oRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`, {
            signal: AbortSignal.timeout(5000),
          });
          if (oRes.ok) {
            const j = await oRes.json();
            if (!author && j.author_name) author = j.author_name;
            if (!ytTitle && j.title) ytTitle = j.title;
            if (!image && j.thumbnail_url) image = j.thumbnail_url;
          }
        } catch {}
      }

      // 3. Fallback jika deskripsi masih kosong: coba regex shortDescription dari watch HTML
      if (!ytDesc && vid) {
        try {
          const res = await fetch(`https://www.youtube.com/watch?v=${vid}`, {
            headers: {
              'User-Agent': getRandomUa(),
              'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
            },
            signal: AbortSignal.timeout(6000),
          });
          if (res.ok) {
            const html = await res.text();
            const m = html.match(/"shortDescription":\s*"((?:\\.|[^"\\])*)"/);
            if (m) {
              try {
                ytDesc = JSON.parse(`"${m[1]}"`);
              } catch {
                ytDesc = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
              }
            }
          }
        } catch {}
      }

      // Susun paragraf konten
      const paras = [];
      if (author) paras.push(`Video oleh kanal: ${author}`);
      if (ytTitle) paras.push(ytTitle);

      if (ytDesc) {
        // Deskripsi lengkap video YouTube (semua baris/paragraf tanpa terpotong)
        const descLines = ytDesc.split(/\r?\n+/).map((l) => l.trim()).filter(Boolean);
        paras.push(...descLines);
        fullContent = [ytTitle, ytDesc].filter(Boolean).join('\n\n');
        snippet = fullContent.slice(0, 400);
      } else {
        const ytSnippet = fallbackSnippet || ytTitle;
        if (ytSnippet && ytSnippet !== ytTitle) paras.push(ytSnippet);
        fullContent = ytSnippet;
        snippet = (ytSnippet || ytTitle).slice(0, 400);
      }

      contentHtml = parasToHtml(paras);
    } else if (host.includes('instagram.com') || host.includes('threads.net')) {
      // Instagram & Threads: Link preview bot (facebookexternalhit) bypass login wall dan mengambil caption penuh
      const res = await fetch(targetUrl, {
        headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.html)' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const html = await res.text();
        const metaDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                         html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || '';
        
        // Pola caption IG: "12K likes, 38 comments - username on November 3, 2026: \"CAPTION HERE\""
        const m = metaDesc.match(/:\s*(?:&quot;|"|“)([\s\S]+?)(?:&quot;|"|”)?$/i);
        fullContent = decodeHtmlEntities(m ? m[1] : metaDesc);
        snippet = fullContent.slice(0, 400);

        image = pickImage(html, targetUrl);
        const authorMatch = metaDesc.match(/-\s*([a-zA-Z0-9._]+)\s+on/i);
        if (authorMatch) author = '@' + authorMatch[1];
      }

      // Fallback Instagram embed/captioned/ (teknik Bughopper14)
      if (!fullContent && host.includes('instagram.com')) {
        const postCode = targetUrl.match(/(?:p|reel)\/([a-zA-Z0-9_-]+)/)?.[1];
        if (postCode) {
          try {
            const embRes = await fetch(`https://www.instagram.com/p/${postCode}/embed/captioned/`, {
              headers: { 'User-Agent': getRandomUa() },
              signal: AbortSignal.timeout(5000),
            });
            if (embRes.ok) {
              const embHtml = await embRes.text();
              const capMatch = embHtml.match(/<div[^>]*class=["'][^"']*Caption[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
              if (capMatch) {
                fullContent = decodeHtmlEntities(capMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
                snippet = fullContent.slice(0, 400);
              }
            }
          } catch {}
        }
      }
    } else if (host.includes('tiktok.com')) {
      // TikTok: Endpoint resmi oEmbed bebas auth
      const oembedRes = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(targetUrl)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (oembedRes.ok) {
        const j = await oembedRes.json();
        fullContent = decodeHtmlEntities(j.title || '');
        snippet = fullContent.slice(0, 400);
        author = j.author_name ? `${j.author_name} (@${j.author_unique_id || ''})` : '';
      }
    } else if (host.includes('twitter.com') || host.includes('x.com')) {
      // Twitter / X: Endpoint resmi oEmbed publish.twitter.com
      const twRes = await fetch(`https://publish.twitter.com/oembed?url=${encodeURIComponent(targetUrl)}&omit_script=true`, {
        signal: AbortSignal.timeout(5000),
      });
      if (twRes.ok) {
        const j = await twRes.json();
        fullContent = decodeHtmlEntities((j.html || '').replace(/<[^>]+>/g, ' '));
        snippet = fullContent.slice(0, 400);
        author = j.author_name ? `${j.author_name} (@${j.author_url ? j.author_url.split('/').pop() : ''})` : '';
      }
    } else if (host.includes('reddit.com')) {
      // Reddit: Endpoint oEmbed resmi
      const rRes = await fetch(`https://www.reddit.com/oembed?url=${encodeURIComponent(targetUrl)}`, {
        headers: { 'User-Agent': getRandomUa() },
        signal: AbortSignal.timeout(5000),
      });
      if (rRes.ok) {
        const j = await rRes.json();
        fullContent = decodeHtmlEntities(j.title || '');
        author = j.author_name || '';
      }
    } else {
      // Berita & Web Umum: header browser dengan User-Agent rotasi; bila ditolak, coba lagi sebagai crawler pratinjau tautan / curl native
      const page = /(^|\.)news\.google\.com$/.test(host) ? null : await fetchHtml(targetUrl);
      if (page) {
        let extracted = extractArticleBody(page.html);

        // Jika hasil ekstraksi HTML statis terlalu sedikit (kurang dari 250 karakter, misal situs SPA JS seperti MSN), ambil via headless Playwright
        if ((!extracted.content || extracted.content.length < 250) && !/(^|\.)news\.google\.com$/.test(host)) {
          try {
            const browserHtml = await fetchWithBrowser(targetUrl);
            if (browserHtml && !isBlockedHtml(browserHtml)) {
              const bExtracted = extractArticleBody(browserHtml);
              if (bExtracted.content && bExtracted.content.length > (extracted.content?.length || 0)) {
                extracted = bExtracted;
                page.html = browserHtml;
              }
            }
          } catch {}
        }

        fullContent = extracted.content;
        contentHtml = extracted.html;
        snippet = extracted.description || fullContent.slice(0, 400);
        image = pickImage(page.html, page.url);
      }
    }
  } catch (err) {
    // Fail gracefully: jika website menolak / timeout, fallback ke snippet bawaan
  }

  // Fallback jika tidak ada konten paragraf tapi ada snippet bawaan
  if (!contentHtml && (fallbackSnippet || fullContent)) {
    const textFallback = fallbackSnippet || fullContent;
    contentHtml = parasToHtml([textFallback]);
  }

  const result = {
    targetUrl,
    author,
    fullContent: fullContent || snippet || fallbackSnippet || fallbackTitle,
    contentHtml: contentHtml || '',
    image,
    snippet: snippet || (fullContent ? fullContent.slice(0, 400) : fallbackSnippet || fallbackTitle.slice(0, 400)),
  };

  setCache(rawUrl, result);
  if (targetUrl !== rawUrl) setCache(targetUrl, result);
  return result;
}

// Memperkaya batch berita dengan konten lengkap dan caption postingan secara paralel
export async function enrichItemsWithContent(items = [], { concurrency = 5, onProgress } = {}) {
  if (!items.length) return items;

  let completed = 0;
  const total = items.length;
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const it = items[idx++];
      try {
        const extracted = await extractContentFromUrl(it.url, { title: it.title, snippet: it.snippet });
        if (extracted) {
          if (extracted.targetUrl && extracted.targetUrl !== it.url) {
            it.originalUrl = it.url;
            it.url = extracted.targetUrl;
          }
          if (extracted.fullContent && extracted.fullContent.length > (it.snippet?.length || 0)) {
            it.fullContent = extracted.fullContent;
            it.snippet = extracted.snippet || it.snippet;
          }
          if (extracted.contentHtml) it.contentHtml = extracted.contentHtml;
          if (extracted.image && !it.image) it.image = extracted.image;
          if (extracted.author && !it.author) {
            it.author = extracted.author;
          }
          // Perbarui teks gabungan untuk klasifikasi AI agar kaya konteks
          const parts = [it.title, it.snippet, it.fullContent].filter(Boolean);
          it.text = parts.join(' — ').slice(0, 3500);
        }
      } catch {}
      completed++;
      if (onProgress) onProgress(completed, total);
    }
  }

  const pool = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(pool);
  return items;
}

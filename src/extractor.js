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
import { getRandomUa } from './financial.js';
import { isGoogleNewsUrl, resolveArticleUrl } from './resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLAYWRIGHT_SCRIPT = path.join(__dirname, '../listener/fetch_playwright.py');

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

// Unduh via native curl.exe untuk situs yang dilindungi Cloudflare / TLS fingerprinting
async function fetchWithCurl(url) {
  try {
    const { stdout } = await execFileAsync('curl.exe', [
      '-s', '-L',
      '--max-time', '6',
      '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '-H', 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
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
    const { stdout } = await execFileAsync('python', [PLAYWRIGHT_SCRIPT, url], {
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
      if (html.includes('Just a moment...') || html.includes('challenge-running') || html.includes('Enable JavaScript and cookies')) continue;
      return { html, url: res.url || url };
    } catch { /* coba UA berikutnya */ }
  }

  // Percobaan 3: Native curl fallback jika node fetch di-challenge oleh Cloudflare
  try {
    const curlHtml = await fetchWithCurl(url);
    if (curlHtml && !curlHtml.includes('Just a moment...') && !curlHtml.includes('challenge-running') && !curlHtml.includes('Enable JavaScript and cookies')) {
      return { html: curlHtml.slice(0, 1_500_000), url };
    }
  } catch {}

  // Percobaan 4: Headless Playwright untuk memecahkan Cloudflare Managed Challenge
  try {
    const browserHtml = await fetchWithBrowser(url);
    if (browserHtml && !browserHtml.includes('Just a moment...') && !browserHtml.includes('challenge-running') && !browserHtml.includes('Enable JavaScript and cookies')) {
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

// Ekstraksi paragraf bersih dari halaman artikel berita
function extractArticleBody(html) {
  let cleanHtml = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, ' ');

  const ogDesc = cleanHtml.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1] ||
                 cleanHtml.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)?.[1] || '';

  const containerMatch = cleanHtml.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                         cleanHtml.match(/<div[^>]*class=["'][^"']*(?:detail-text|read__content|read__article|article__content|detail__body-text|post-content|entry-content|article-content|story-content|content-details|content-post|news-detail|detailsContent|content__article|main-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  
  const searchScope = (containerMatch ? containerMatch[1] : cleanHtml)
    .replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '</p><p>')
    .replace(/<\/p>/gi, '</p>\n');

  const paras = [];
  const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRegex.exec(searchScope)) !== null) {
    const rawP = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (rawP.length >= 35 &&
        !/^(baca juga|simak juga|baca disini|baca artikel|pilihan editor|artikel berlanjut setelah iklan|advertisement|halaman selanjutnya|halaman:|scroll to continue|redaksi|editor:|penulis:|kontributor:|\*\s*executive brief)/i.test(rawP)) {
      paras.push(rawP);
    }
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
      // YouTube: Endpoint oEmbed resmi untuk author kanal & thumbnail
      try {
        const oRes = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(targetUrl)}&format=json`, {
          signal: AbortSignal.timeout(5000),
        });
        if (oRes.ok) {
          const j = await oRes.json();
          author = j.author_name ? `${j.author_name}` : '';
          image = j.thumbnail_url || null;
          const ytTitle = j.title || fallbackTitle;
          const ytSnippet = fallbackSnippet || ytTitle;
          fullContent = ytSnippet;
          snippet = (ytSnippet || ytTitle).slice(0, 400);
          const paras = [];
          if (author) paras.push(`Video oleh kanal: ${author}`);
          if (ytTitle && ytTitle !== ytSnippet) paras.push(ytTitle);
          if (ytSnippet) paras.push(ytSnippet);
          contentHtml = parasToHtml(paras);
        }
      } catch {}
      if (!image) {
        const vid = targetUrl.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1];
        if (vid) image = `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`;
      }
      if (!contentHtml && (fallbackSnippet || fallbackTitle)) {
        fullContent = fallbackSnippet || fallbackTitle;
        contentHtml = parasToHtml([fullContent]);
      }
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
        const extracted = extractArticleBody(page.html);
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

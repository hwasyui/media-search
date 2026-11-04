// Ekstraksi konten lengkap (full article body & social media post caption) secara aman tanpa bot-block.
//   - Google News RSS: Decode redirect CBMi... ke URL asli penerbit
//   - Berita / Web: Ekstraksi paragraf semantik (<article>, <p>) & meta description
//   - Instagram & Threads: Link preview crawler (facebookexternalhit) untuk mengambil caption utuh tanpa login-wall
//   - TikTok & X/Twitter: Endpoint resmi oEmbed untuk mendapatkan caption & nama akun
//   - Concurrency limiter & in-memory cache agar cepat dan tidak membebani network
import pkg from 'google-news-url-decoder';
const { GoogleDecoder } = pkg;
import { getRandomUa } from './financial.js';

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
    .replace(/&#x[0-9a-f]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
                         cleanHtml.match(/<div[^>]*class=["'][^"']*(?:detail-text|read__content|detail__body-text|post-content|entry-content|article-content|story-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  
  const searchScope = containerMatch ? containerMatch[1] : cleanHtml;

  const paras = [];
  const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRegex.exec(searchScope)) !== null) {
    const rawP = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (rawP.length >= 35 &&
        !/^(baca juga|simak juga|baca disini|baca artikel|advertisement|halaman selanjutnya|halaman:|scroll to continue|redaksi|editor:|penulis:|kontributor:)/i.test(rawP)) {
      paras.push(rawP);
    }
  }

  const fullText = paras.join('\n\n').slice(0, 3000);
  const desc = decodeHtmlEntities(ogDesc);
  return {
    description: desc,
    content: fullText ? decodeHtmlEntities(fullText) : desc,
  };
}

export async function extractContentFromUrl(rawUrl) {
  if (!rawUrl) return null;
  const cached = getCached(rawUrl);
  if (cached) return cached;

  let targetUrl = rawUrl;

  // 1. Decode Google News redirect jika URL mengarah ke news.google.com
  if (rawUrl.includes('news.google.com/rss/articles/') || rawUrl.includes('news.google.com/articles/')) {
    try {
      const dec = await decoder.decode(rawUrl);
      if (dec?.status && dec.decoded_url) {
        targetUrl = dec.decoded_url;
      }
    } catch {}
  }

  let host = '';
  try { host = new URL(targetUrl).hostname.replace(/^www\./, ''); } catch { return null; }

  let fullContent = '';
  let snippet = '';
  let author = '';

  // 2. Ekstraksi spesifik platform
  try {
    if (host.includes('instagram.com') || host.includes('threads.net')) {
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
      // Berita & Web Umum: Browser header Windows dengan User-Agent rotasi
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent': getRandomUa(),
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8',
          'Referer': 'https://news.google.com/',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const html = await res.text();
        const extracted = extractArticleBody(html);
        fullContent = extracted.content;
        snippet = extracted.description || fullContent.slice(0, 400);
      }
    }
  } catch (err) {
    // Fail gracefully: jika website menolak / timeout, fallback ke snippet bawaan
  }

  const result = {
    targetUrl,
    author,
    fullContent: fullContent || snippet,
    snippet: snippet || fullContent.slice(0, 400),
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
        const extracted = await extractContentFromUrl(it.url);
        if (extracted) {
          if (extracted.targetUrl && extracted.targetUrl !== it.url) {
            it.originalUrl = it.url;
            it.url = extracted.targetUrl;
          }
          if (extracted.fullContent && extracted.fullContent.length > (it.snippet?.length || 0)) {
            it.fullContent = extracted.fullContent;
            it.snippet = extracted.snippet || it.snippet;
          }
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


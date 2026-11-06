// Ekstraksi artikel + pembersihan boilerplate (iklan, menu, sidebar, embed sosmed, 'baca juga').
import * as cheerio from 'cheerio';
import { parseDate } from './models.js';
import { cpSlice, decodeBytes, textOf } from './util.js';

// Tag yang hampir pasti bukan isi artikel.
const JUNK_TAGS = ['script', 'style', 'noscript', 'iframe', 'form', 'nav', 'aside', 'footer', 'header',
  'svg', 'button', 'template', 'ins', 'figure', 'video', 'audio', 'select', 'input'];

// Class/id penanda sampah (iklan, widget, share, komentar, rekomendasi, embed sosmed).
const JUNK_HINT = new RegExp(
  '(^|[\\s_-])(ad|ads|adv|advert|advertisement|adsbygoogle|banner|sidebar|widget|related|share|sharing|social|'
  + 'comment|comments|promo|newsletter|subscribe|breadcrumb|menu|navbar|popular|trending|terkait|bacajuga|baca-juga|'
  + 'readmore|tagcloud|taglist|embed|twitter-tweet|instagram-media|tiktok-embed|fb-post|fb-video|overlay|modal|popup)'
  + '([\\s_-]|$)', 'i');

// Baris yang jelas sampah walau berada di dalam badan artikel.
const JUNK_LINE = /^(baca juga|baca selengkapnya|simak juga|lihat juga|baca:|advertisement|iklan|scroll to continue|klik di sini|ikuti kami|follow|bagikan|share|sumber:|editor:|penulis:|copyright|©|all rights reserved)(?![\p{L}\p{N}_])/iu;

// Urutan penyeleksi wadah artikel yang umum dipakai portal Indonesia.
const BODY_SELECTORS = [
  '[itemprop="articleBody"]', '.detail__body-text', '.read__content', '.article-content-body',
  '.entry-content', '.post-content', '.article-body', '.detail-content', '.content-detail', 'article',
];

const ARTICLE_TYPES = ['article', 'posting', 'report'];   // NewsArticle, BlogPosting, ReportageNewsArticle, dll

function flattenJsonld(data) {
  if (Array.isArray(data)) return data.flatMap(flattenJsonld);
  if (data && typeof data === 'object') {
    const items = [data];
    if ('@graph' in data) items.push(...flattenJsonld(data['@graph']));
    return items;
  }
  return [];
}

function authorName(val) {
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val)) return val.map(authorName).filter(Boolean).join(', ');
  if (val && typeof val === 'object') return String(val.name ?? '').trim();
  return '';
}

const truthy = (v) => (v === undefined || v === null || v === '' || v === false ? undefined : v);

/** Judul/tanggal/penulis dari JSON-LD, lalu OpenGraph/meta, lalu <time>. */
function metadata($) {
  const meta = {};
  const setdefault = (k, v) => { if (!(k in meta)) meta[k] = v; };
  $('script[type="application/ld+json"]').each((_, s) => {
    let data;
    try { data = JSON.parse(($(s).contents().toArray().map((c) => c.data || '').join('')) || ''); } catch { return; }
    for (const node of flattenJsonld(data)) {
      let t = node['@type'] ?? '';
      t = Array.isArray(t) ? t.join(' ') : String(t);
      if (ARTICLE_TYPES.some((k) => t.toLowerCase().includes(k))) {
        setdefault('title', node.headline);
        setdefault('published', node.datePublished || node.dateCreated);
        setdefault('author', authorName(node.author));
        setdefault('body', node.articleBody);
      }
    }
  });

  const m = (...names) => {
    for (const n of names) {
      let tag = $('meta').filter((_, e) => $(e).attr('property') === n).first();
      if (!tag.length) tag = $('meta').filter((_, e) => $(e).attr('name') === n).first();
      const c = tag.length ? tag.attr('content') : undefined;
      if (c) return c.trim();
    }
    return null;
  };

  const titleEl = $('title').first();
  const titleStr = titleEl.length && titleEl[0].children.length === 1 && titleEl[0].children[0].type === 'text' ? titleEl.text().trim() : '';
  meta.title = truthy(meta.title) || m('og:title', 'twitter:title') || titleStr;
  meta.published = truthy(meta.published) || m('article:published_time', 'pubdate', 'publishdate', 'date', 'DC.date.issued');
  if (!meta.published) {
    const t = $('time[datetime]').first();
    meta.published = t.length ? t.attr('datetime') : null;
  }
  meta.author = truthy(meta.author) || m('author', 'article:author', 'twitter:creator') || '';
  meta.description = m('og:description', 'description') || '';
  const canon = $('link').filter((_, e) => ($(e).attr('rel') || '').toLowerCase().split(/\s+/).includes('canonical')).first();
  meta.canonical = canon.length ? canon.attr('href') ?? null : null;
  return meta;
}

function stripJunk($) {
  $(JUNK_TAGS.join(',')).remove();
  $('blockquote').filter((_, e) => /twitter-tweet|instagram-media|tiktok-embed/.test($(e).attr('class') || '')).remove();
  // Elemen anak dari induk yang sudah dibuang ikut terlepas; lewati yang sudah tidak punya induk.
  $('*').toArray().forEach((el) => {
    if (!el.parent && el.name !== 'html') return;
    if (['html', 'body', 'article', 'main'].includes(el.name)) return;
    const cls = ($(el).attr('class') || '').split(/\s+/).filter(Boolean).join(' ');
    const hint = `${cls} ${$(el).attr('id') || ''}`;
    if (hint.trim() && JUNK_HINT.test(hint)) $(el).remove();
  });
}

function paragraphs($, container) {
  const lines = [];
  $(container).find('p, li, h2, h3').each((_, p) => {
    const text = textOf(p).replace(/\s+/g, ' ');
    if (text.length < 25 || JUNK_LINE.test(text)) return;
    if (p.name === 'li' && text.length < 60) return;       // butir menu/daftar pendek
    lines.push(text);
  });
  return lines;
}

function bestContainer($) {
  for (const sel of BODY_SELECTORS) {
    const el = $(sel).first();
    if (el.length && paragraphs($, el[0]).length >= 2) return el[0];
  }
  // Fallback: induk dengan total teks paragraf terbanyak (kerapatan teks).
  const scores = new Map();
  $('p').each((_, p) => {
    const text = textOf(p);
    if (text.length < 40 || !p.parent) return;
    let linkLen = 0;
    $(p).find('a').each((_, a) => { linkLen += textOf(a, { strip: false }).length; });
    scores.set(p.parent, (scores.get(p.parent) || 0) + text.length - 2 * linkLen);   // penalti teks yang isinya link
  });
  let best = null, bestScore = -Infinity;
  for (const [node, sc] of scores) if (sc > bestScore) { best = node; bestScore = sc; }
  return best;
}

/** HTML mentah (Buffer/string) -> artikel, atau null bila tidak ditemukan isi artikel yang layak. */
export function extractArticle(html, url, snippetChars = 1500) {
  let meta, paras;
  try {
    const $ = cheerio.load(decodeBytes(html));
    meta = metadata($);                    // ambil metadata SEBELUM membuang <script>/<header>
    stripJunk($);
    const container = bestContainer($);
    paras = container ? paragraphs($, container) : [];
  } catch {                                // struktur HTML tak terduga: lewati artikel ini saja
    return null;
  }

  let text = paras.join('\n');
  if (text.length < 120) text = String(meta.body || meta.description || text || '').trim();   // fallback ke JSON-LD articleBody / meta description
  if (text.length < 60 || !meta.title) return null;

  let snippet = cpSlice(text, snippetChars);
  if (text.length > snippetChars) {
    const i = snippet.lastIndexOf(' ');
    snippet = `${i >= 0 ? snippet.slice(0, i) : snippet}…`;
  }
  return {
    url: String(meta.canonical || url).trim(),
    title: String(meta.title).replace(/\s+/g, ' ').trim(),
    published: parseDate(meta.published),
    author: meta.author || '',
    text,
    snippet,
  };
}

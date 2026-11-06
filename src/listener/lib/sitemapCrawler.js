// Jalur B: fallback bila RSS tidak ada. Baca sitemap (termasuk news-sitemap), lalu halaman utama.
import * as cheerio from 'cheerio';
import { candidate, parseDate } from './models.js';
import { decodeBytes, logger as log, textOf } from './util.js';

// Bagian URL yang bukan artikel (halaman indeks, tag, penulis, pencarian, dll).
const NON_ARTICLE = /\/(tag|tags|topic|topik|category|kategori|author|penulis|page|search|cari|login|register|about|kontak|contact|redaksi|pedoman|privacy|terms|rss|feed|indeks|index)(\/|$|\?)/i;
const ASSET = /\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|mp3|css|js|xml)(\?|$)/i;

const parseUrl = (u) => { try { return new URL(u); } catch { return null; } };
const stripWww = (h) => h.replace(/www\./g, '');

function looksLikeArticle(url, baseHost) {
  const p = parseUrl(url);
  if (!p || stripWww(p.host) !== stripWww(baseHost)) return false;
  const path = p.pathname.replace(/^\/+|\/+$/g, '');
  if (!path || NON_ARTICLE.test(`${p.pathname}/`) || ASSET.test(url)) return false;
  const last = path.split('/').pop();
  // artikel biasanya: slug panjang bertanda hubung, atau mengandung id angka / tanggal
  return (last.includes('-') && last.length > 20) || /\d{5,}/.test(path) || /\/20\d\d\/\d\d\//.test(p.pathname);
}

const first = ($, scope, ...names) => {
  for (const n of names) {
    const el = $(scope).find(n.replace(':', '\\:')).first();
    if (el.length) return el;
  }
  return null;
};
const txt = (el) => textOf(el[0], { strip: false });

async function parseSitemapXml(session, url, since, depth = 0) {
  const resp = await session.get(url);
  if (resp === null) return [];
  const $ = cheerio.load(decodeBytes(resp.content), { xmlMode: true });
  const out = [];

  if ($('sitemapindex').length) {
    if (depth >= 2) return [];
    const children = [];
    $('sitemap').each((_, sm) => {
      const loc = $(sm).find('loc').first();
      const lm = $(sm).find('lastmod').first();
      const lastmod = lm.length ? parseDate(txt(lm)) : null;
      if (loc.length && (lastmod === null || lastmod >= since)) children.push([lastmod ? lastmod.getTime() : -8.64e15, txt(loc).trim()]);
    });
    children.sort((a, b) => (b[0] - a[0]) || (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0));   // sitemap terbaru dulu
    for (const [, child] of children.slice(0, 3)) {                                       // batasi supaya tidak menelusuri ratusan file arsip
      out.push(...await parseSitemapXml(session, child, since, depth + 1));
    }
    return out;
  }

  $('url').each((_, u) => {
    const loc = $(u).find('loc').first();
    if (!loc.length) return;
    const newsDate = first($, u, 'news:publication_date', 'publication_date');
    const newsTitle = first($, u, 'news:title', 'title');
    const dateTag = newsDate || first($, u, 'lastmod');
    const date = dateTag ? parseDate(txt(dateTag)) : null;
    if (date !== null && date < since) return;
    out.push(candidate({ url: txt(loc).trim(), title: newsTitle ? txt(newsTitle).trim() : '', published: date }));
  });
  return out;
}

export async function fetchSitemaps(session, sitemapUrls, maxAgeDays) {
  const since = new Date(Date.now() - maxAgeDays * 86400000);
  const out = [];
  for (const url of sitemapUrls) {
    try {
      out.push(...await parseSitemapXml(session, url, since));
    } catch (e) {   // struktur XML aneh jangan menghentikan sumber lain
      log.warning('sitemap error %s: %s', url, e.message);
    }
  }
  // Sitemap sering memuat halaman indeks (tag, topik, kategori, file); buang yang jelas bukan artikel.
  return out.filter((c) => !(NON_ARTICLE.test(`${parseUrl(c.url)?.pathname ?? ''}/`) || ASSET.test(c.url)));
}

/** Pilihan terakhir: ambil link yang tampak seperti artikel dari halaman utama. */
export async function fetchHomepageLinks(session, homeUrl) {
  const resp = await session.get(homeUrl);
  if (resp === null) return [];
  const $ = cheerio.load(decodeBytes(resp.content));
  const host = new URL(homeUrl).host;
  const seen = new Set(), out = [];
  $('a[href]').each((_, a) => {
    let url;
    try { url = new URL($(a).attr('href'), homeUrl).href.split('#')[0]; } catch { return; }
    const title = textOf(a);
    if (seen.has(url) || title.length < 20 || !looksLikeArticle(url, host)) return;
    seen.add(url);
    out.push(candidate({ url, title }));
  });
  return out;
}

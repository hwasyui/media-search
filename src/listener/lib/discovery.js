// Auto-discovery: untuk domain apa pun (blog, forum, situs instansi) cari RSS dan sitemap-nya.
import * as cheerio from 'cheerio';
import { fetchRss } from './rssCrawler.js';
import { decodeBytes } from './util.js';

const COMMON_FEED_PATHS = ['/feed', '/feed/', '/rss', '/rss.xml', '/atom.xml', '/feeds/posts/default', '/index.xml'];
const COMMON_SITEMAP_PATHS = ['/news-sitemap.xml', '/sitemap_index.xml', '/sitemap.xml'];

const dedupe = (a) => [...new Set(a)];

/** Return { home, rss: [...], sitemaps: [...] }. Jumlah request dibatasi (tiap request kena delay). */
export async function discover(session, domain) {
  const home = domain.startsWith('http') ? domain : `https://${domain}/`;
  const rss = [];
  const sitemaps = [];

  // 1) <link rel="alternate" type="application/rss+xml"> di halaman utama
  const resp = await session.get(home);
  if (resp !== null) {
    const $ = cheerio.load(decodeBytes(resp.content));
    $('link[rel]').each((_, el) => {
      const rel = ($(el).attr('rel') || '').toLowerCase().split(/\s+/);
      const t = ($(el).attr('type') || '').toLowerCase();
      const href = $(el).attr('href');
      if (rel.includes('alternate') && (t.includes('rss') || t.includes('atom')) && href) rss.push(new URL(href, home).href);
    });
  }

  // 2) sitemap yang diumumkan di robots.txt (sudah di-cache oleh session)
  sitemaps.push(...await session.sitemapsFromRobots(home));

  // 3) tebak path umum hanya bila belum ketemu
  if (!rss.length) {
    for (const path of COMMON_FEED_PATHS) {
      const candidate = new URL(path, home).href;
      if ((await fetchRss(session, candidate)).length) {          // valid kalau ada entry
        rss.push(candidate);
        break;
      }
    }
  }
  if (!sitemaps.length) {
    for (const path of COMMON_SITEMAP_PATHS) {
      const candidate = new URL(path, home).href;
      const r = await session.get(candidate);
      if (r !== null) {
        const head = r.content.subarray(0, 2000).toString('latin1');
        if (head.includes('<urlset') || head.includes('<sitemapindex')) {
          sitemaps.push(candidate);
          break;
        }
      }
    }
  }

  return { home, rss: dedupe(rss), sitemaps: dedupe(sitemaps) };
}

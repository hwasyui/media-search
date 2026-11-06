// Orkestrasi satu siklus crawl: sumber -> kandidat link -> ambil artikel -> bersihkan -> filter boolean -> simpan.
import { discover } from './discovery.js';
import { extractArticle } from './extractor.js';
import { fetchRss } from './rssCrawler.js';
import { fetchHomepageLinks, fetchSitemaps } from './sitemapCrawler.js';
import { logger as log } from './util.js';

export const defaultSettings = () => ({
  maxAgeDays: 2.0,
  maxPerSource: 30,
  fast: false,          // true: filter hanya dari judul+ringkasan RSS (tanpa download artikel yang tidak cocok)
  storeAll: false,      // true: simpan semua artikel (gaya index Talkwalker), query dipakai hanya untuk label
  snippetChars: 1500,
});

/** Lengkapi rss/sitemaps sumber lewat auto-discovery (di-cache di MySQL, tabel crawler_discovery, supaya tidak diulang tiap siklus). */
async function resolve(session, source, storage) {
  if ((source.rss && source.rss.length) || (source.sitemaps && source.sitemaps.length) || !source.domain) return source;
  let found = await storage.getDiscovery(source.domain);
  if (found === null) {
    log.info('[%s] auto-discovery %s', source.name, source.domain);
    found = await discover(session, source.domain);
    await storage.saveDiscovery(source.domain, found);
  }
  return { ...source, rss: found.rss, sitemaps: found.sitemaps, home: source.home || found.home };
}

/** Jalur A (RSS) dulu; kalau kosong jatuh ke Jalur B (sitemap), lalu halaman utama. */
async function collect(session, source, cfg) {
  let cands = [];
  for (const feed of source.rss || []) cands.push(...await fetchRss(session, feed));
  let path = 'rss';
  if (!cands.length && source.sitemaps?.length) {
    cands = await fetchSitemaps(session, source.sitemaps, cfg.maxAgeDays);
    path = 'sitemap';
  }
  if (!cands.length) {
    const home = source.home || (source.domain ? `https://${source.domain}/` : null);
    if (home) {
      cands = await fetchHomepageLinks(session, home);
      path = 'homepage';
    }
  }
  return [[...new Map(cands.map((c) => [c.url, c])).values()], path];
}

export async function processSource(session, storage, source, queries, cfg) {
  const stats = { source: source.name, path: '-', candidates: 0, fetched: 0, saved: 0, error: null };
  try {
    source = await resolve(session, source, storage);
    const [cands, path] = await collect(session, source, cfg);
    stats.path = path;
    const since = new Date(Date.now() - cfg.maxAgeDays * 86400000);
    let fresh = [];
    for (const c of cands) {
      if ((c.published === null || c.published >= since) && !(await storage.isSeen(c.url))) fresh.push(c);
    }
    fresh.sort((a, b) => (b.published || since) - (a.published || since));       // terbaru dulu
    fresh = fresh.slice(0, cfg.maxPerSource);
    stats.candidates = fresh.length;
    const domain = new URL(source.home || `https://${source.domain || ''}`).host.replace(/www\./g, '');

    for (const c of fresh) {
      try {
        // Pra-filter murah dari judul+ringkasan (mode fast); hemat request ke server situs.
        if (cfg.fast && queries.size && !cfg.storeAll) {
          const pre = `${c.title} ${c.summary} ${c.tags.join(' ')}`;
          if (![...queries.values()].some((q) => q.matches(pre))) {
            await storage.markSeen(c.url);
            continue;
          }
        }
        const resp = await session.get(c.url);
        stats.fetched++;
        let art = resp !== null ? extractArticle(resp.content, c.url, cfg.snippetChars) : null;
        await storage.markSeen(c.url);
        if (art === null && c.title && c.summary.length >= 60) {
          // Halaman artikel diblok/tak terbaca (mis. 403): pakai ringkasan dari RSS yang memang dipublikasikan.
          art = { url: c.url, title: c.title, published: c.published, author: c.author, text: c.summary, snippet: c.summary.slice(0, cfg.snippetChars) };
        }
        if (art === null) continue;
        art.published = art.published || c.published;
        art.author = art.author || c.author;
        if (art.published && art.published < since) continue;
        const full = `${art.title} ${art.text}`;
        const matched = [...queries].filter(([, q]) => q.matches(full)).map(([name]) => name);
        if (queries.size && !matched.length && !cfg.storeAll) continue;           // real-time filtering: buang yang tak relevan
        if (await storage.save(art, { domain, category: source.category || 'news', source: source.name, matched })) {
          stats.saved++;
          log.info('[%s] + %s %s', source.name, matched.length ? matched : '', art.title.slice(0, 90));
        }
      } catch (e) {            // satu artikel bermasalah tidak boleh menghentikan sumber ini
        log.warning('[%s] gagal proses %s: %s', source.name, c.url, e.message);
      }
    }
  } catch (e) {
    stats.error = e.message;
    log.error('[%s] sumber gagal: %s', source.name, e.message);
  }
  return stats;
}

/** Satu siklus. Paralel antar sumber (host berbeda); delay tetap berlaku per host di HttpClient. */
export async function runCycle(sources, queries, storage, session, cfg, workers = 4) {
  const results = new Array(sources.length);
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const i = next++;
      results[i] = await processSource(session, storage, sources[i], queries, cfg);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, sources.length) }, worker));
  return results;
}

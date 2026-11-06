import { fail, json, query } from '@/lib/server/http';
import { layerOf } from '@/lib/server/server-state';
import * as newsApi from '@/news/news.js';

const { listNews, newsCounts, newsTotal, platformCounts } = newsApi as any;

// Feed campuran semua perusahaan (atau satu perusahaan). filter: all|official|rumor|positive|risk|video; sort: mix|latest|relevant
// Semua filter opsional dan bisa dikombinasikan; lihat where() di src/news/news.js. raw=1: data mentah (semua hasil crawl).
export async function GET(req: Request) {
  try {
    const q = query(req);
    const f = {
      company: q.company, filter: q.filter || 'all', q: q.q, days: q.days === undefined ? 30 : Number(q.days), platform: q.platform, kind: q.kind, tier: q.tier,
      impact: q.impact, category: q.category, sentiment: q.sentiment, riskMin: q.risk_min, riskCat: q.risk_cat, related: q.related, ai: q.ai, source: q.source, raw: layerOf(q),
    };
    const [items, counts, total, platforms] = await Promise.all([
      listNews({ ...f, sort: q.sort || 'mix', limit: q.limit, offset: q.offset }), newsCounts(f), newsTotal(f), platformCounts({ company: f.company, q: f.q, days: f.days, raw: f.raw }),
    ]);
    return json({ items, counts, total, platforms });
  } catch (e) { return fail(e); }
}

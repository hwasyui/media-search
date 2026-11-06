import { fail, json, query } from '@/lib/server/http';
import { layerOf } from '@/lib/server/server-state';
import * as newsApi from '@/news/news.js';

const newsFacets = (newsApi as any).newsFacets;

// Pilihan dropdown filter beserta jumlahnya
export async function GET(req: Request) {
  try {
    const q = query(req);
    return json(await newsFacets({ company: q.company, days: q.days === undefined ? 7 : Number(q.days), raw: layerOf(q) }));
  } catch (e) { return fail(e); }
}

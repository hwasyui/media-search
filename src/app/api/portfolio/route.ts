import { fail, json, query } from '@/lib/server/http';
import { layerOf } from '@/lib/server/server-state';
import { latestRiskProfiles, listCompanies } from '@/db/store.js';
import { companyNewsStats } from '@/news/news.js';

// Daftar perusahaan + ringkasan sinyal masing-masing (sidebar / portofolio)
export async function GET(req: Request) {
  try {
    const [companies, stats, risks] = await Promise.all([listCompanies(), companyNewsStats(30, layerOf(query(req))), latestRiskProfiles()]);
    return json(companies.map((c: any) => ({ ...c, risk: risks[c.id] || null, stats: stats[c.id] || { total: 0, official: 0, rumor: 0, positive: 0, risk: 0, latest: null } })));
  } catch (e) { return fail(e); }
}

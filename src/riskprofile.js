// Profil risiko pembiayaan per perusahaan: aturan (risk.js) + data keuangan terbaru yang tersimpan + berita 90 hari.
import { buildRiskProfile } from './risk.js';
import { listRiskNews } from './news.js';
import { latestFinancial } from './store.js';

export async function getRiskProfile(company, financial) {
  const [news, snap] = await Promise.all([listRiskNews(company.id, 90), financial ? null : latestFinancial(company.id).catch(() => null)]);
  return buildRiskProfile({ company, financial: financial || snap, news });
}

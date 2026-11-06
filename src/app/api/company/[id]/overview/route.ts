import { fail, json, query } from '@/lib/server/http';
import { backgroundFinancialRefresh, FIN_TTL_MS, layerOf } from '@/lib/server/server-state';
import { getCompany, latestFinancial } from '@/db/store.js';
import { saveFinancial } from '@/db/save.js';
import { getFinancials } from '@/risk/financial.js';
import * as newsApi from '@/news/news.js';
import { buildNarrative } from '@/risk/narrative.js';

// Halaman perusahaan: profil + data keuangan (perusahaan terbuka) + narasi aturan + hitungan sinyal
const { companyNewsStats, newsCounts } = newsApi as any;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const q = query(req);
    const company = await getCompany((await ctx.params).id);
    if (!company) return json({ error: 'perusahaan tidak ditemukan' }, 404);
    let financial: any = null, financialError: string | null = null;
    if (company.type === 'public' && company.ticker) {
      try {
        // Halaman tidak pernah menunggu sumber eksternal bila sudah ada snapshot: snapshot terbaru ditampilkan seketika, dan bila lebih tua dari
        // FINANCIAL_TTL_HOURS (default 24 jam) pembaruan berjalan di latar belakang (maks. sekali per 15 menit per perusahaan, termasuk saat gagal).
        // Hanya saat belum ada snapshot sama sekali (pertama kali) halaman menunggu pengambilan langsung.
        // Diperbarui lewat tombol "Perbarui" di halaman, Task Runner, atau ?fresh=1 (paksa ambil dari sumber).
        const snapRecent = q.fresh === '1' ? null : await latestFinancial(company.id).catch(() => null);
        if (snapRecent) {
          financial = snapRecent;
          if (Date.now() - new Date(snapRecent.fetchedAt).getTime() >= FIN_TTL_MS) backgroundFinancialRefresh(company);
        } else financial = await getFinancials(company.ticker);
        if (financial !== snapRecent && (financial.errors?.price || financial.errors?.valuation)) {
          // Yahoo sesekali membatasi request (429): pakai snapshot terakhir dari DB untuk bagian yang gagal, dan tandai basi.
          const snap = await latestFinancial(company.id).catch(() => null);
          financial = { ...financial, errors: { ...financial.errors }, stale: {} };
          for (const k of ['price', 'valuation']) {
            if (financial.errors[k] && snap?.[k]) { financial[k] = snap[k]; financial.stale[k] = snap.fetchedAt; }
          }
        } else if (financial !== snapRecent) {      // snapshot dari DB tidak disimpan ulang
          saveFinancial(company.id, financial).catch((e: Error) => console.error('[db] saveFinancial:', e.message));
        }
      } catch (e) { financialError = (e as Error).message; }
    }
    const [counts, stats] = await Promise.all([newsCounts({ company: company.id, raw: layerOf(q) }), companyNewsStats(30, layerOf(q))]);
    const st = stats[company.id] || { total: 0, official: 0, rumor: 0, positive: 0, risk: 0 };
    return json({ company, financial, financialError, counts, stats: st, narrative: buildNarrative({ company, financial, stats: st }) });
  } catch (e) { return fail(e); }
}

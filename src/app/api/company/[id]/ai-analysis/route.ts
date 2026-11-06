import { fail, json } from '@/lib/server/http';
import { state } from '@/lib/server/server-state';
import { getCompany, latestAnalysis, latestFinancial } from '@/db/store.js';
import { saveAnalysis } from '@/db/save.js';
import { getFinancials } from '@/risk/financial.js';
import { generateAnalysis } from '@/ai/analysis.js';

type Ctx = { params: Promise<{ id: string }> };

// Analisis AI: baca yang terakhir tersimpan / buat yang baru (data keuangan + berita 30 hari -> Groq -> simpan ke DB)
export async function GET(_req: Request, ctx: Ctx) {
  try { return json({ analysis: await latestAnalysis((await ctx.params).id) }); } catch (e) { return fail(e); }
}

export async function POST(_req: Request, ctx: Ctx) {
  const company = await getCompany((await ctx.params).id).catch(() => null);
  if (!company) return json({ error: 'perusahaan tidak ditemukan' }, 404);
  if (state.analyzing.has(company.id)) return json({ error: 'analisis sedang dibuat' }, 409);
  state.analyzing.add(company.id);
  try {
    let financial: any = null;
    if (company.type === 'public' && company.ticker) financial = await getFinancials(company.ticker).catch(() => null);
    if (financial && (financial.errors?.price || financial.errors?.valuation)) {
      const snap = await latestFinancial(company.id).catch(() => null);
      if (snap) financial = { ...financial, price: financial.price || snap.price, valuation: financial.valuation || snap.valuation };
    }
    const analysis = await generateAnalysis(company, financial);
    await saveAnalysis(company.id, analysis);
    return json({ analysis: { generatedAt: new Date().toISOString(), ...analysis } });
  } catch (e) {
    return fail(e, 500);
  } finally {
    state.analyzing.delete(company.id);
  }
}

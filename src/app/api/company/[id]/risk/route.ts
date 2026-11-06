import { fail, json } from '@/lib/server/http';
import { getCompany } from '@/db/store.js';
import { saveRiskProfile } from '@/db/save.js';
import { getRiskProfile } from '@/risk/riskprofile.js';

// Profil risiko pembiayaan (aturan, tanpa AI): skor per kategori, rating, faktor + bukti, checklist verifikasi
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const company = await getCompany((await ctx.params).id);
    if (!company) return json({ error: 'perusahaan tidak ditemukan' }, 404);
    const profile = await getRiskProfile(company);
    saveRiskProfile(company.id, profile, 'view').catch((e: Error) => console.error('[db] saveRiskProfile:', e.message));
    return json({ company: { id: company.id, name: company.name, type: company.type }, ...profile });
  } catch (e) { return fail(e); }
}

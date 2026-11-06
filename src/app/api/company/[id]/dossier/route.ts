import { fail, json } from '@/lib/server/http';
import { state } from '@/lib/server/server-state';
import { getCompany } from '@/db/store.js';
import { generateCompanyDossier, getCompanyDossier } from '@/ai/dossier.js';

type Ctx = { params: Promise<{ id: string }> };

// Dossier Korporasi: baca yang tersimpan / ekstrak baru dari berita, keterbukaan, dan profil
export async function GET(_req: Request, ctx: Ctx) {
  try { return json({ dossier: await getCompanyDossier((await ctx.params).id) }); } catch (e) { return fail(e, 500); }
}

export async function POST(_req: Request, ctx: Ctx) {
  const company = await getCompany((await ctx.params).id).catch(() => null);
  if (!company) return json({ error: 'perusahaan tidak ditemukan' }, 404);
  if (state.extractingDossier.has(company.id)) return json({ error: 'ekstraksi dossier sedang berlangsung' }, 409);
  state.extractingDossier.add(company.id);
  try {
    return json({ dossier: await generateCompanyDossier(company.id) });
  } catch (e) {
    return fail(e, 500);
  } finally {
    state.extractingDossier.delete(company.id);
  }
}

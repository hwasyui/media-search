import { fail, json } from '@/lib/server/http';
import { getCompany } from '@/db/store.js';
import { saveFinancial } from '@/db/save.js';
import { getFinancials } from '@/risk/financial.js';

// Perbarui data keuangan satu emiten sekarang (tombol di halaman): ambil dari sumber lalu simpan sebagai snapshot baru di DB.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const co = await getCompany((await ctx.params).id);
    if (!co) return json({ error: 'perusahaan tidak ditemukan' }, 404);
    if (co.type !== 'public' || !co.ticker) return json({ error: 'bukan perusahaan terbuka' }, 400);
    const data = await getFinancials(co.ticker, { force: true });
    const bad = data.errors?.price || data.errors?.valuation;
    if (!bad) await saveFinancial(co.id, data, { force: true });
    return json({ saved: !bad, errors: data.errors, fetchedAt: data.fetchedAt });
  } catch (e) { return fail(e); }
}

import { fail, json } from '@/lib/server/http';
import { getCompany } from '@/db/store.js';
import { saveFinancial } from '@/db/save.js';
import { getFinancials } from '@/risk/financial.js';

// Data keuangan perusahaan terbuka (non-AI): harga, valuasi, laporan keuangan, pengumuman IDX
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const co = await getCompany(id);
    let ticker = co?.ticker;
    if (!co) {
      // Cek apakah parameter id adalah ticker langsung (misal: /api/financial/ASII atau /api/financial/BMRI)
      const rawTicker = id.toUpperCase();
      if (/^[A-Z0-9]{2,6}$/.test(rawTicker)) ticker = rawTicker;
      else return json({ error: 'perusahaan tidak ditemukan' }, 404);
    } else if (co.type !== 'public' || !co.ticker) {
      return json({ error: `${co.name} bukan perusahaan terbuka (tidak ada data keuangan publik)` }, 400);
    }
    const data = await getFinancials(ticker);
    const saved = co ? await saveFinancial(co.id, data).catch((e: Error) => { console.error('[db] saveFinancial:', e.message); return false; }) : false;
    return json({ company: co ? co.id : ticker.toLowerCase(), saved, ...data });
  } catch (e) { return fail(e); }
}

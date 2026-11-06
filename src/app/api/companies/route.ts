import { body, fail, json } from '@/lib/server/http';
import { cleanQueries } from '@/lib/server/company-input';
import { saveCompany } from '@/db/save.js';

// Tambah / registrasi perusahaan baru
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const { name, ticker, type = 'public', sector, aliases = [], stakeholders = [] } = b;
    const extraQueries = cleanQueries(b.extraQueries);
    if (!name) return json({ error: 'Nama perusahaan wajib diisi' }, 400);
    const co = await saveCompany({
      name,
      ticker: (ticker || '').toUpperCase() || null,
      type,
      sector: sector || (type === 'public' ? 'Bursa Efek Indonesia' : 'Swasta / BUMN'),
      aliases: aliases.length ? aliases : [name, ...(ticker ? [ticker.toUpperCase()] : [])],
      stakeholders,
      extraQueries,
    });
    return json({ company: co });
  } catch (e) { return fail(e); }
}

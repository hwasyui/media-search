import { body, fail, json } from '@/lib/server/http';
import { cleanAliases, cleanQueries } from '@/lib/server/company-input';
import { updateCompanySearch } from '@/db/store.js';

// Ubah alias dan query tambahan perusahaan yang sudah ada
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const b = await body(req);
    const co = await updateCompanySearch(id, {
      aliases: b.aliases === undefined ? undefined : cleanAliases(b.aliases),
      extraQueries: b.extraQueries === undefined ? undefined : cleanQueries(b.extraQueries),
    });
    if (!co) return json({ error: 'perusahaan tidak ditemukan' }, 404);
    return json({ company: co });
  } catch (e) { return fail(e); }
}

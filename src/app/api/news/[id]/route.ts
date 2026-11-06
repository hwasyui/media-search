import { fail, isDigits, json } from '@/lib/server/http';
import { getNewsDetail } from '@/news/news.js';

// Detail satu berita untuk modal (semua sinyal + jejak penemuan)
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isDigits(id)) return new Response('Not Found', { status: 404 });
    const d = await getNewsDetail(Number(id));
    if (!d) return json({ error: 'berita tidak ditemukan' }, 404);
    return json(d);
  } catch (e) { return fail(e); }
}

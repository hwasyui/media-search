import { readFile } from 'node:fs/promises';
import { db } from '@/db/db.js';
import { isDigits } from '@/lib/server/http';
import { getCover } from '@/content/covers.js';

const notFound = () => new Response(null, { status: 404 });

// Gambar sampul dari cache lokal (data/covers); diunduh sekali dari situs penerbit bila belum ada.
// 404 bila tidak bisa: kartu memakai logo penerbit.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isDigits(id)) return notFound();
    const [[r]] = await db().query('SELECT image_url FROM news_items WHERE id = ?', [Number(id)]);
    const c = r?.image_url ? await getCover(r.image_url) : null;
    if (!c) return notFound();
    return new Response(new Uint8Array(await readFile(c.file)), { headers: { 'Content-Type': c.type, 'Cache-Control': 'public, max-age=604800' } });
  } catch { return notFound(); }
}

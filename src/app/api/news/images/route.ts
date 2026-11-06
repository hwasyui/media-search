import { body, fail, json } from '@/lib/server/http';
import { enrichByIds } from '@/content/images.js';

// Gambar artikel secara lazy: browser meminta untuk berita yang sedang tampil (maks. 12 id per permintaan).
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const ids = (Array.isArray(b?.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 12);
    return json({ images: await enrichByIds(ids) });
  } catch (e) { return fail(e); }
}

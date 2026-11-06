import { fail, json } from '@/lib/server/http';
import { getCompany } from '@/db/store.js';
import { publicJob, startJob } from '@/jobs/jobs.js';

// "Perbarui berita" (satu perusahaan) memakai pipeline Task Runner yang sama: simpan dulu, buang duplikat, lewati berita yang sudah
// terklasifikasi lengkap, saring konten konsumen, dan hormati jalur (crawl/AI) supaya tidak bentrok atau membuang token.
// Mengembalikan job; browser memantau statusnya lewat /api/jobs/:id.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const co = await getCompany(id);
    if (!co) return json({ error: 'perusahaan tidak ditemukan' }, 404);
    return json(publicJob(startJob('portfolio', { companies: [co.id] })));
  } catch (e) { return fail(e); }
}

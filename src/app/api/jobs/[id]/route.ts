import { json } from '@/lib/server/http';
import { getJob, publicJob } from '@/jobs/jobs.js';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const job = getJob((await ctx.params).id);
  if (!job) return json({ error: 'job tidak ditemukan' }, 404);
  return json({ ...publicJob(job), serverNow: Date.now() });      // serverNow: browser menghitung durasi dengan jam server
}

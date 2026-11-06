import { fail, json } from '@/lib/server/http';
import { cancelJob, publicJob } from '@/jobs/jobs.js';

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try { return json(publicJob(cancelJob((await ctx.params).id))); } catch (e) { return fail(e); }
}

import { body, fail, json } from '@/lib/server/http';
import { listJobs, publicJob, startJob } from '@/jobs/jobs.js';

// ---- Job background: simulasi kualitas data & cron crawl (tombol di /jobs) ----
export async function POST(req: Request) {
  try {
    const { type, options = {} } = await body(req);
    return json(publicJob(startJob(type, options)));
  } catch (e) { return fail(e); }
}

export async function GET() {
  return json(listJobs());
}

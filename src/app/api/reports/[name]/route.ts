import { fail, json } from '@/lib/server/http';
import { readReport } from '@/db/store.js';

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  try { return json(await readReport((await ctx.params).name)); } catch (e) { return fail(e); }
}

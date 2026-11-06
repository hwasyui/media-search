import { fail, json } from '@/lib/server/http';
import { layerCounts } from '@/news/news.js';

export async function GET() {
  try { return json(await layerCounts()); } catch (e) { return fail(e); }
}

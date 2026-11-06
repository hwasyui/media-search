import { body, fail, json } from '@/lib/server/http';
import { cleanItems } from '@/news/clean.js';
import { enrichItemsWithContent } from '@/content/extractor.js';

// Step 2: clean + enrich content (full article body & social post caption)
export async function POST(req: Request) {
  try {
    const b = await body(req);
    const cleaned = cleanItems(b.items || []);
    await enrichItemsWithContent(cleaned.items, { concurrency: 6 });
    return json(cleaned);
  } catch (e) { return fail(e); }
}

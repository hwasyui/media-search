import { body, fail, json } from '@/lib/server/http';
import { classifyItems, MAX_ITEMS as AI_MAX_ITEMS } from '@/ai/classify.js';
import { saveNews } from '@/db/save.js';

// Step 3: classify (Groq)
export async function POST(req: Request) {
  try {
    const { items = [], entity = {} } = await body(req);
    const out = await classifyItems(items.slice(0, AI_MAX_ITEMS), entity);
    let saved = null, saveError = null;
    if (entity.id) {
      try { saved = await saveNews(entity.id, out); } catch (e) { saveError = (e as Error).message; console.error('[db] saveNews:', saveError); }
    }
    return json({ items: out, saved, saveError });
  } catch (e) { return fail(e); }
}

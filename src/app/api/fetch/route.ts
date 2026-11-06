import { body, fail, json } from '@/lib/server/http';
import { parseFetchInput } from '@/lib/server/fetch-input';
import { runSearch } from '@/news/search.js';

// Step 1: fetch (batch)
export async function POST(req: Request) {
  const { keywords, sources, modifiers, total } = parseFetchInput(await body(req));
  if (!keywords.length || !sources.length || !modifiers.length) return json({ error: 'keyword, sumber, dan modifier wajib diisi' }, 400);
  if (total > 60) return json({ error: 'Terlalu banyak kombinasi query (maks 60). Kurangi sumber/modifier/keyword.' }, 400);
  try {
    return json(await runSearch({ keywords, sources, modifiers }));
  } catch (e) { return fail(e); }
}

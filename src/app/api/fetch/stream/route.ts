import { body, json } from '@/lib/server/http';
import { parseFetchInput } from '@/lib/server/fetch-input';
import { runSearch } from '@/news/search.js';

// Step 1 streaming: hasil muncul per query begitu selesai (SSE)
export async function POST(req: Request) {
  const { keywords, sources, modifiers, total } = parseFetchInput(await body(req));
  if (!keywords.length || !sources.length || !modifiers.length) return json({ error: 'keyword, sumber, dan modifier wajib diisi' }, 400);
  if (total > 60) return json({ error: 'Terlalu banyak kombinasi query (maks 60).' }, 400);

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => { try { controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* klien sudah menutup koneksi */ } };
      try {
        const result = await runSearch({ keywords, sources, modifiers }, (chunk: object) => send({ type: 'chunk', ...chunk }));
        send({ type: 'done', queries: result.queries, errors: result.errors, perSource: result.perSource });
      } catch (e) {
        send({ type: 'error', error: (e as Error).message });
      }
      try { controller.close(); } catch { /* sudah tertutup */ }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
}

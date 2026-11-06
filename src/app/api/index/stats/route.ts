import { json } from '@/lib/server/http';
import { runCrawler } from '@/news/sources/adapters.js';

// ---- Index lokal (crawler src/listener/) ----
export async function GET() {
  try {
    return json(JSON.parse(await runCrawler(['stats'])));
  } catch (e) {
    return json({ error: `Crawler tidak bisa dijalankan: ${(e as Error).message}` }, 500);
  }
}

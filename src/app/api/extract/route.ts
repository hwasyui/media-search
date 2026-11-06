import { body, fail, json } from '@/lib/server/http';
import { extractContentFromUrl } from '@/content/extractor.js';

// Ekstraksi konten artikel / caption postingan spesifik
export async function POST(req: Request) {
  try {
    const { url } = await body(req);
    if (!url) return json({ error: 'url wajib diisi' }, 400);
    const content = await extractContentFromUrl(url);
    return json(content || { url, fullContent: '', snippet: '' });
  } catch (e) { return fail(e); }
}

import { body, clientIp, fail, json } from '@/lib/server/http';
import { state } from '@/lib/server/server-state';
import { chat as assistantChat } from '@/ai/assistant.js';

// Asisten AI: jawaban dari konteks DB (beranda / perusahaan / berita). Dibatasi per IP: maks. 20 pertanyaan per 10 menit.
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const now = Date.now();
    const hits = (state.chatHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (hits.length >= 20) return json({ error: 'Terlalu banyak pertanyaan. Coba lagi beberapa menit lagi.' }, 429);
    hits.push(now); state.chatHits.set(ip, hits);

    const b = await body(req);
    const parseCx = (x: any) => (x && x.type === 'company' && /^[w.-]{1,60}$/.test(String(x.companyId || '')) ? { type: 'company', companyId: String(x.companyId) } : x && x.type === 'news' && Number.isInteger(Number(x.newsId)) ? { type: 'news', newsId: Number(x.newsId) } : x && x.type === 'home' ? { type: 'home' } : null);
    const raw = Array.isArray(b?.messages) ? b.messages.slice(-8) : [];
    const messages = raw.filter((m: any) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim()).map((m: any) => ({ role: m.role, content: m.content.slice(0, 1200), cx: parseCx(m.cx) }));
    if (!messages.length || messages.at(-1).role !== 'user') return json({ error: 'pertanyaan kosong' }, 400);
    const c = b?.context || {};
    const context = c.type === 'company' ? { type: 'company', companyId: String(c.companyId || '') } : c.type === 'news' ? { type: 'news', newsId: Number(c.newsId) } : { type: 'home' };
    const parse = (x: any) => (x && x.type === 'company' ? { type: 'company', companyId: String(x.companyId || '') } : x && x.type === 'news' && Number.isInteger(Number(x.newsId)) ? { type: 'news', newsId: Number(x.newsId) } : null);
    return json(await (assistantChat as any)(messages, context, parse(b?.prev)));      // prev: konteks jawaban terakhir bila halamannya sudah berganti
  } catch (e) { return fail(e); }
}

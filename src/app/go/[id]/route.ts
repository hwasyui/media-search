import { db } from '@/db/db.js';
import { isDigits } from '@/lib/server/http';
import { isGoogleNewsUrl, resolveArticleUrl } from '@/links/resolver.js';

const text = (s: string, status: number) => new Response(s, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
const redirect = (url: string) => new Response(null, { status: 302, headers: { Location: url } });

// Buka artikel asli satu berita. Tautan Google News diselesaikan langsung ke alamat penerbit asli.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isDigits(id)) return text('Not Found', 404);
    const [[r]] = await db().query('SELECT id, found_url AS url, title, snippet, source_domain, source_name, article_url FROM news_items WHERE id = ?', [Number(id)]);
    if (!r) return text('berita tidak ditemukan', 404);
    if (r.article_url && !isGoogleNewsUrl(r.article_url)) return redirect(r.article_url);
    if (!isGoogleNewsUrl(r.url)) return redirect(r.url);

    const art = await resolveArticleUrl(r);
    if (art && !isGoogleNewsUrl(art) && !/^https?:[/][/](www[.])?google[.]com[/]search/i.test(art)) {
      await db().query('UPDATE news_items SET article_url = ?, link_error = NULL WHERE id = ?', [art, r.id]).catch(() => {});
      return redirect(art);
    }
    return text('Tautan artikel penerbit asli belum tersedia atau tidak dapat diakses.', 404);
  } catch { return text('gagal membuka artikel', 500); }
}

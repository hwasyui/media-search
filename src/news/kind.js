// Platform dan jenis konten berita, untuk memisahkan berita yang relevan bagi analisis kredit dari obrolan publik dan konten konsumen.
// platform & resmi/berita/persepsi_publik berasal dari domain sumber (aturan tetap); 'konsumen' ditandai AI dari isi artikel.
//
//  platform     : dari mana berita itu berasal (media massa, blog/forum, media sosial, video, sumber resmi)
//  content_kind : 'resmi'           rilis/situs resmi
//                 'berita'          pemberitaan media massa
//                 'persepsi_publik' suara publik: media sosial, video, blog, forum (pengalaman pengguna/mitra, opini)
//                 'konsumen'        konten bantuan/tutorial/promo konsumen ("cara login", "kode promo", lowongan);
//                                   TIDAK relevan untuk analisis kredit -> disaring dari data cleaned (tetap ada di data mentah)

export const PLATFORMS = ['berita', 'blog', 'sosmed', 'video', 'resmi'];
export const PLATFORM_LABEL = { berita: 'Berita (media massa)', blog: 'Blog & forum', sosmed: 'Media sosial', video: 'Video (YouTube)', resmi: 'Sumber resmi' };

const VIDEO = /(^|\.)(youtube\.com|youtu\.be)$/i;
const SOSMED = /(^|\.)(x\.com|twitter\.com|instagram\.com|facebook\.com|fb\.com|tiktok\.com|threads\.net|linkedin\.com|reddit\.com|telegram\.org|t\.me)$/i;
const BLOG = /(^|\.)(kompasiana\.com|medium\.com|substack\.com|tumblr\.com|kaskus\.co\.id|quora\.com|stockbit\.com)$|\.(blogspot|wordpress)\./i;

// Konten BUATAN PENGGUNA (surat pembaca/keluhan konsumen/ulasan): bukan hasil redaksi media, jadi bukan "berita" dan tidak boleh jadi berita utama.
// Dikenali dari domain yang seluruh isinya tulisan pengguna, atau dari penanda baku di teks halaman (mis. "Artikel ini adalah buatan pengguna").
const UGC_DOMAIN = /(^|\.)(mediakonsumen\.com|suarapembaca\.detik\.com|suara-pembaca\.com|kompasiana\.com|kaskus\.co\.id|quora\.com|medium\.com|tumblr\.com)$/i;
const UGC_MARK = /(artikel|tulisan|konten|opini) ini (adalah|merupakan) (buatan pengguna|karya pembaca|tanggung jawab (sepenuhnya )?penulis)|dan menjadi tanggung jawab penulisnya|rubrik surat pembaca/i;
export function isUserGenerated({ domain, text } = {}) {
  const d = String(domain || '').replace(/^www\./, '');
  return UGC_DOMAIN.test(d) || UGC_MARK.test(String(text || '').slice(-4000)) || UGC_MARK.test(String(text || '').slice(0, 1500));
}

export function platformOf({ domain, tier, ugc }) {
  if (ugc && tier !== 'official') return 'blog';
  const d = String(domain || '').replace(/^www\./, '');
  if (tier === 'official') return 'resmi';
  if (VIDEO.test(d)) return 'video';
  if (SOSMED.test(d)) return 'sosmed';
  if (BLOG.test(d)) return 'blog';
  return 'berita';
}

// Jenis konten dari sumbernya saja (domain/tier), tanpa menebak dari kata di judul. 'konsumen' TIDAK ditentukan di sini: hanya AI yang
// menandainya setelah membaca isi (lihat konten_konsumen di classify.js), karena kata seperti "promo" atau "cara" bisa muncul di berita bisnis.
export function contentKind({ tier, platform }) {
  if (tier === 'official') return 'resmi';
  if (platform === 'video' || platform === 'sosmed' || platform === 'blog') return 'persepsi_publik';
  return 'berita';
}

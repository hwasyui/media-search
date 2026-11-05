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

export function platformOf({ domain, tier }) {
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

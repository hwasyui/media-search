// Platform dan jenis konten berita (aturan, tanpa AI), untuk memisahkan berita yang relevan bagi analisis kredit dari obrolan publik dan konten konsumen.
//
//  platform     : dari mana berita itu berasal (media massa, blog/forum, media sosial, video, sumber resmi)
//  content_kind : 'resmi'           rilis/situs resmi
//                 'berita'          pemberitaan media massa
//                 'persepsi_publik' suara publik: media sosial, video, blog, forum (pengalaman pengguna/mitra, opini)
//                 'konsumen'        konten bantuan/tutorial/promo konsumen ("cara login", "kode promo", lowongan);
//                                   TIDAK relevan untuk analisis kredit -> disaring dari data cleaned (tetap ada di data mentah)
import { riskTags } from './risk.js';

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

// Konten bantuan/tutorial/promo konsumen yang tidak berguna untuk menilai risiko debitur.
const CONSUMER = /^(cara|tutorial|tips|panduan|begini cara|inilah cara|langkah)\b|\b(tutorial|unboxing|kode promo|promo|diskon|voucher|cashback|gratis ongkir|lowongan|loker|rekrutmen|call center|nomor (telepon|cs|customer service)|customer service|cara (login|daftar|membuat|menggunakan|mengatasi|cek|menghubungi|melihat|mengubah|menghapus|top ?up|isi|bayar|klaim|mendapatkan|menarik|aktivasi))\b/i;
// Kata bisnis/keuangan/risiko yang membatalkan penyaringan di atas (mis. "promo" dalam berita laba, atau "cara" dalam berita restrukturisasi).
const BUSINESS = /\b(saham|laba|rugi|dividen|utang|pailit|pkpu|gugatan|korupsi|akuisisi|direksi|komisaris|laporan keuangan|ojk|sanksi|ipo|buyback|merger|phk|restrukturisasi|obligasi|kredit|pembiayaan)\b/i;

export function contentKind({ title, snippet, tier, platform }) {
  const text = (title || '') + ' ' + (snippet || '');
  if (tier === 'official') return 'resmi';
  if (CONSUMER.test(title || '') && !BUSINESS.test(text) && !riskTags(text).length) return 'konsumen';
  if (platform === 'video' || platform === 'sosmed' || platform === 'blog') return 'persepsi_publik';
  return 'berita';
}

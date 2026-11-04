/* Modal detail berita: klik judul berita mana pun untuk melihat semua info spesifiknya (query penemuan, cuplikan isi, penilaian aturan, hasil AI, risiko).
   Memakai helper global portal.html: $, esc, safeUrl, ago, api, toast. */
'use strict';

const NW_CAT = { hukum: 'Hukum & Perkara', keuangan: 'Keuangan & Pembayaran', integritas: 'Integritas & Fraud', kepemilikan: 'Kepemilikan & Pengurus (deed)', operasional: 'Operasional', regulasi: 'Regulasi & Sanksi', reputasi: 'Reputasi' };
const NW_SRC = { google_news: 'Google News (RSS)', bing_news: 'Bing News (RSS)', youtube: 'YouTube', social_media: 'Media sosial (via Google)', local_index: 'Index lokal crawler' };
// Apakah RSS/API tiap alat memberi cuplikan isi (penjelasan untuk pengguna)
const NW_SNIP = {
  google_news: 'Google News RSS hanya memberi judul dan tautan pengalihan; tidak ada cuplikan isi.',
  bing_news: 'Bing News RSS biasanya menyertakan cuplikan isi.',
  youtube: 'YouTube memberi potongan deskripsi video (bisa kosong).',
  social_media: 'Hasil pencarian media sosial memberi potongan teks halaman.',
  local_index: 'Index lokal crawler menyimpan cuplikan dari isi artikel.',
};
const NW_MOD = { none: 'Polos (nama saja)', isu: 'Isu / kabar', viral: 'Viral', kontroversi: 'Kontroversi', keluhan: 'Keluhan publik', rumor: 'Rumor' };
const NW_KIND = { resmi: 'Resmi', berita: 'Berita', persepsi_publik: 'Persepsi publik', konsumen: 'Tutorial/konsumen (disaring)' };
const NW_PLAT = { berita: 'Berita (media massa)', blog: 'Blog & forum', sosmed: 'Media sosial', video: 'Video (YouTube)', resmi: 'Sumber resmi' };
const NW_TIER = { official: 'Resmi (instansi/bursa)', mainstream: 'Media massa', social_forum: 'Media sosial/forum' };
const fmtDT = (v) => (v ? new Date(v).toLocaleString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const yn = (v) => (v == null ? '–' : v ? 'Ya' : 'Tidak');

function nwRow(label, value, hint) {
  return '<div class="nw-r"><span>' + esc(label) + (hint ? ' <i title="' + esc(hint) + '">?</i>' : '') + '</span><div>' + value + '</div></div>';
}
function nwSection(title, body, note) {
  return '<section class="nw-s"><h5>' + esc(title) + '</h5>' + (note ? '<div class="sm dim" style="margin:-4px 0 8px">' + esc(note) + '</div>' : '') + body + '</section>';
}

function cleanedStatus(d) {
  if (d.content_kind === 'konsumen') return ['t-gray', 'Tidak masuk data cleaned', 'Disaring: konten tutorial/promo/lowongan konsumen yang tidak relevan untuk analisis kredit.'];
  if (d.related === 0) return ['t-gray', 'Tidak masuk data cleaned', 'Disaring: judul dan cuplikan tidak menyebut perusahaan maupun pemangku kepentingannya.'];
  if (d.relevant === 0) return ['t-gray', 'Tidak masuk data cleaned', 'Disaring: AI menilai berita ini tidak relevan dengan perusahaan.'];
  if (d.related_via && d.related_via !== 'perusahaan' && d.relevant !== 1) return ['t-amber', 'Menunggu konfirmasi AI', 'Hanya menyebut pemangku kepentingan; baru masuk data cleaned setelah AI mengonfirmasi relevan (jalankan "Klasifikasi ulang").'];
  return ['t-green', 'Masuk data cleaned', 'Terkait perusahaan dan tidak ada alasan penyaringan.'];
}

function renderNews(d) {
  const [stCls, stLabel, stWhy] = cleanedStatus(d);
  const fav = d.source_domain ? '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(d.source_domain) + '&sz=32" width="16" height="16" alt="" referrerpolicy="no-referrer" style="margin-right:6px;vertical-align:-3px" onerror="this.remove()">' : '';
  const via = Array.isArray(d.found_via) && d.found_via.length
    ? d.found_via.map((v) => '<div class="nw-q"><b>' + esc(NW_SRC[v.src] || v.src || 'sumber tidak tercatat') + '</b>'
      + (v.q ? '<div class="mono">' + esc(v.q) + '</div>' : '') + '<div class="sm muted">kata kunci: ' + esc(v.keyword || '–') + ' · modifier: ' + esc(NW_MOD[v.modifier] || v.modifier || '–') + '</div></div>').join('')
    : '<div class="muted sm">Jejak query tidak tercatat (berita ini disimpan sebelum fitur pelacakan ada; akan terisi saat muncul lagi di crawl berikutnya). Kata kunci yang cocok: <b>' + esc(d.keyword || '–') + '</b></div>';
  const relTxt = d.related === 0 ? 'Tidak menyebut perusahaan maupun pemangku kepentingannya'
    : d.related_via === 'perusahaan' ? 'Menyebut <b>nama/alias perusahaan</b> di judul atau cuplikan'
    : 'Menyebut pemangku kepentingan: <b>' + esc(String(d.related_via || '').replace('stakeholder: ', '')) + '</b> (bukan perusahaannya langsung)';
  const tags = Array.isArray(d.risk_tags) && d.risk_tags.length
    ? d.risk_tags.map((t) => '<div class="nw-q"><span class="tag ' + (t.severity >= 4 ? 't-red' : t.severity >= 3 ? 't-amber' : 't-gray') + '">tingkat ' + t.severity + '/5</span> <b>' + esc(NW_CAT[t.cat] || t.cat) + '</b> <span class="muted">· kata pemicu: “' + esc(t.hit) + '”</span></div>').join('')
    : '<div class="muted sm">Tidak ada kata pemicu risiko pada judul/cuplikan.</div>';
  const adapterNames = (d.adapters || []).map((a) => NW_SRC[a] || a).join(' + ');
  const aiOk = d.ai_status === 'ok';
  const ai = aiOk
    ? nwRow('Relevan dengan perusahaan', yn(d.relevant)) + nwRow('Kategori', esc(d.category || '–'), 'fakta, rumor, atau tidak jelas') + nwRow('Sentimen', esc(d.sentiment || '–'))
      + nwRow('Keyakinan', d.confidence == null ? '–' : d.confidence + '%') + nwRow('Topik', esc(d.topic || '–'))
      + nwRow('Alasan AI', d.reason ? esc(d.reason) : '<span class="muted">–</span>')
      + nwRow('Sinyal risiko dari AI', Array.isArray(d.risk_signals) && d.risk_signals.length ? d.risk_signals.map((x) => '<span class="tag t-gray">' + esc(typeof x === 'string' ? x : JSON.stringify(x)) + '</span>').join(' ') : '<span class="muted">tidak ada</span>')
    : '<div class="muted">' + (d.ai_status === 'failed' ? 'AI gagal memproses berita ini: <span class="mono">' + esc(d.ai_error || 'tanpa keterangan') + '</span> Jalankan "Klasifikasi ulang" di Task Runner.' : d.content_kind === 'konsumen' ? 'Tidak dikirim ke AI (konten konsumen disaring untuk menghemat token).' : 'Belum diklasifikasi AI.') + '</div>';

  $('#nwBody').innerHTML =
    '<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:10px">'
    + '<span class="tag t-cyan">' + esc(d.company_ticker || d.company_name) + '</span>'
    + '<span class="tag t-gray">' + esc(NW_PLAT[d.platform] || d.platform) + '</span>'
    + '<span class="tag t-violet">' + esc(NW_KIND[d.content_kind] || d.content_kind) + '</span>'
    + '<span class="tag t-gray" title="Alat yang mengambil berita ini">via ' + esc(adapterNames) + '</span>'
    + '<span class="tag ' + stCls + '" title="' + esc(stWhy) + '">' + esc(stLabel) + '</span></div>'
    + '<div class="sm muted" style="margin-bottom:14px">' + fav + esc(d.source_name || d.source_domain || '–') + ' · terbit ' + esc(fmtDT(d.published_at)) + '</div>'
    + nwSection('Isi Berita / Caption Postingan', d.snippet ? '<div class="nw-snip" style="white-space:pre-wrap;line-height:1.6">' + esc(d.snippet) + '</div><div class="sm dim" style="margin-top:6px">Konten artikel &amp; caption postingan diekstrak langsung dari sumber via ' + esc(adapterNames) + '.</div>'
      : '<div class="muted sm">Tidak ada cuplikan/konten. Buka tautan untuk membaca isi lengkap.</div>')
    + nwSection('Kenapa berita ini muncul', nwRow('Diambil oleh (alat)', '<b>' + esc(adapterNames) + '</b>' + (d.adapters_inferred ? ' <span class="muted sm">· diperkirakan dari bentuk tautan (berita lama belum punya jejak)</span>' : ''), 'Alat pengambil data yang menemukan berita ini. Bila ditemukan oleh lebih dari satu alat, semuanya ditulis.') + '<div class="nw-lbl" style="margin-top:8px">Query yang menemukannya</div>' + via
      + nwRow('Kecocokan dengan perusahaan', relTxt)
      + nwRow('Status di data cleaned', '<span class="tag ' + stCls + '">' + esc(stLabel) + '</span> <span class="sm muted">' + esc(stWhy) + '</span>')
      + nwRow('Terlihat di crawl', (d.seen_count || 1) + ' kali · pertama ' + esc(fmtDT(d.fetched_at)) + (d.last_seen_at ? ' · terakhir ' + esc(fmtDT(d.last_seen_at)) : '')))
    + nwSection('Penilaian otomatis', nwRow('Kredibilitas sumber', esc(NW_TIER[d.credibility_tier] || d.credibility_tier || '–') + (d.credibility_score != null ? ' (skor ' + d.credibility_score + ')' : '') + (d.source_domain ? ' · ' + esc(d.source_domain) : ''), 'Dinilai dari domain sumber dengan aturan tetap, bukan AI')
      + nwRow('Dampak', d.impact ? '<span class="tag ' + (d.impact === 'buruk' ? 't-red' : d.impact === 'baik' ? 't-green' : 't-gray') + '">' + esc(d.impact) + '</span> ' + esc(d.impact_reason || '') : '–', 'Dinilai dengan kamus kata (aturan), bukan AI')
      + nwRow('Status sumber', esc(d.status_line || '–')), 'Aturan tetap: hasilnya sama setiap kali (tanpa AI).')
    + nwSection('Hasil AI', '<div class="nw-kv">' + ai + '</div>')
    + nwSection('Risiko pembiayaan', nwRow('Tingkat risiko tertinggi', d.risk_level ? d.risk_level + ' / 5' : 'tidak ada') + tags, 'Tag dihitung dengan aturan dari judul dan cuplikan; dipakai di profil risiko.')
    + '<details class="nw-s"><summary>Detail teknis</summary><div class="nw-kv">'
    + nwRow('ID berita', d.id) + nwRow('Perusahaan', esc(d.company_name)) + nwRow('Platform / jenis', esc((NW_PLAT[d.platform] || d.platform) + ' / ' + (NW_KIND[d.content_kind] || d.content_kind)))
    + nwRow('Tautan', '<span class="mono">' + esc(d.url) + '</span>') + nwRow('Gambar', d.image_url ? '<span class="mono">' + esc(d.image_url) + '</span>' : '–')
    + nwRow('Diproses AI', esc(d.ai_status)) + '</div></details>';

  $('#nwOpen').href = safeUrl(d.url);
  $('#nwTitle').textContent = d.title;
  $('#nwCopy').onclick = () => { navigator.clipboard?.writeText(d.url).then(() => toast('Tautan disalin.'), () => toast('Gagal menyalin tautan.')); };
}

async function openNews(id) {
  $('#nwModal').hidden = false;
  window.__nwId = id;                                   // konteks asisten AI: berita yang sedang dibuka
  window.dispatchEvent(new Event('ms-context'));
  $('#nwTitle').textContent = 'Memuat…';
  $('#nwBody').innerHTML = '<div class="muted" style="padding:20px 0">Memuat detail berita…</div>';
  try { renderNews(await api('/api/news/' + encodeURIComponent(id))); window.dispatchEvent(new Event('ms-context')); }   // judul sudah terisi: perbarui label konteks asisten
  catch (e) { $('#nwBody').innerHTML = '<div class="empty"><b>Gagal memuat detail</b>' + esc(e.message) + '</div>'; }
}
function closeNews() { $('#nwModal').hidden = true; window.__nwId = null; window.dispatchEvent(new Event('ms-context')); }

// Klik di mana pun pada kartu/baris berita (kartu, daftar ringkas, bukti risiko, temuan utama) membuka modal.
// Pengecualian: tautan lain ("Sumber ↗", nama perusahaan), tombol, dan isian tetap berfungsi normal. Ctrl/Cmd/Shift-klik pada judul tetap membuka artikel.
document.addEventListener('click', (e) => {
  if (e.button || e.defaultPrevented) return;
  const host = e.target.closest('[data-nid]');
  if (!host) return;
  const link = e.target.closest('a');
  if (link && !link.hasAttribute('data-nid')) return;                       // tautan lain: biarkan
  if (e.target.closest('button, input, select, textarea, label')) return;
  if (link && (e.ctrlKey || e.metaKey || e.shiftKey)) return;               // buka artikel di tab baru
  e.preventDefault();
  openNews(host.dataset.nid);
});
$('#nwClose').onclick = closeNews;
$('#nwAsk').onclick = () => { if (window.__nwId && window.assistantAsk) window.assistantAsk('Jelaskan berita ini secara rinci: apa isinya, kenapa muncul dan terkait perusahaan, serta apa artinya untuk risiko pinjaman.', { type: 'news', newsId: Number(window.__nwId), label: 'Berita' }); };
$('#nwModal').addEventListener('click', (e) => { if (e.target.id === 'nwModal') closeNews(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#nwModal').hidden) closeNews(); });

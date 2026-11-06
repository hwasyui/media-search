/* Modal detail berita (klik berita mana pun). Urutan: siapa/kapan -> apa artinya bagi debitur (ringkasan + dampak) -> isi berita -> temuan risiko
   beserta kutipan buktinya -> penilaian AI -> info sumber. Hal teknis (alat crawl, query, status data cleaned, ID) hanya ada di "Detail teknis".
   Memakai helper global portal.html: $, esc, safeUrl, ago, api, toast. */
'use strict';

const NW_CAT = { hukum: 'Hukum & perkara', keuangan: 'Keuangan & pembayaran', integritas: 'Integritas & fraud', kepemilikan: 'Kepemilikan & pengurus', operasional: 'Operasional', regulasi: 'Regulasi & sanksi', reputasi: 'Reputasi' };
const NW_SEV = { 1: 'Ringan', 2: 'Rendah', 3: 'Sedang', 4: 'Tinggi', 5: 'Sangat tinggi' };
const NW_SRC = { google_news: 'Google News (RSS)', bing_news: 'Bing News (RSS)', youtube: 'YouTube', social_media: 'Media sosial (via Google)', local_index: 'Index lokal crawler' };
const NW_ROLE = { subjek: 'Subjek utama berita', pihak_terlibat: 'Pihak yang terlibat', disebut_sekilas: 'Hanya disebut sekilas', pihak_lain: 'Bukan perusahaan ini' };
const NW_ROLE_HINT = { subjek: 'Peristiwa utama berita ini tentang perusahaan.', pihak_terlibat: 'Perusahaan ikut terlibat, tetapi bukan fokus utama.', disebut_sekilas: 'Nama perusahaan hanya lewat; peristiwa utamanya tentang hal lain.', pihak_lain: 'Berita ini tentang pihak lain (mis. bernama mirip).' };
const NW_MOD = { none: 'Polos (nama saja)', isu: 'Isu / kabar', viral: 'Viral', kontroversi: 'Kontroversi', keluhan: 'Keluhan publik', rumor: 'Rumor' };
const NW_KIND = { resmi: 'Resmi', berita: 'Berita', persepsi_publik: 'Persepsi publik', konsumen: 'Konten konsumen (disaring)' };
const NW_PLAT = { berita: 'Media massa', blog: 'Blog & forum', sosmed: 'Media sosial', video: 'Video', resmi: 'Sumber resmi' };
const NW_TIER = { official: 'Sumber resmi (instansi/bursa)', mainstream: 'Media massa / situs berita umum', corporate: 'Situs perusahaan / komersial', aggregator: 'Agregator / non-redaksi', social_forum: 'Media sosial / forum' };
const NW_INFO = { fakta: 'Fakta', rumor: 'Rumor', opini: 'Opini / keluhan', tidak_jelas: 'Belum jelas' };
const NW_SENT = { positif: 'Positif', netral: 'Netral', negatif: 'Negatif' };
const AI_MINI = '<span class="ai-mini" title="Dihasilkan oleh AI yang membaca isi artikel">✦ AI</span>';
const fmtDT = (v) => (v ? new Date(v).toLocaleString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const yn = (v) => (v == null ? '–' : v ? 'Ya' : 'Tidak');

const nwRow = (label, value, hint) => '<div class="nw-r"><span>' + esc(label) + (hint ? ' <i title="' + esc(hint) + '">?</i>' : '') + '</span><div>' + value + '</div></div>';
// Hanya paragraf <p> berisi teks yang diterima; tag lain dibuang walau server (atau sumber lain) menulisnya.
function nwSafeBody(html) {
  const out = [];
  String(html || '').replace(/<p>([\s\S]*?)<\/p>/g, (_, t) => { const x = t.replace(/<[^>]*>/g, '').trim(); if (x) out.push('<p>' + x + '</p>'); return ''; });
  return out.join('');
}

// Apakah tautan artikel sudah terbukti bisa dibuka? Hanya "terbukti" bila sistem berhasil membuka artikelnya dan membaca isinya.
function linkStatus(d) {
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return '–'; } };
  const google = /^https:\/\/news\.google\.com\//.test(d.url || '');
  if (d.article_url && d.content_html) return '<span class="tag t-green">Tautan bisa dibuka</span> sistem berhasil membuka artikel di ' + esc(host(d.article_url)) + ' dan membaca isinya.';
  if (d.article_url) return '<span class="tag t-amber">Alamat asli ditemukan</span> ' + esc(host(d.article_url)) + (d.link_error === 'isi_tidak_terbaca' || !d.content_html ? ', tetapi isinya belum berhasil dibaca (situs menolak akses, berbayar, atau tanpa teks).' : '.');
  if (google) return '<span class="tag t-amber">Belum dibuka</span> ini tautan pengalihan Google News. ' + (d.link_error === 'decode_429' ? 'Alamat penerbit belum bisa dicari karena Google sedang membatasi permintaan; dicoba lagi saat Anda menekan "Baca artikel asli" atau lewat "Lengkapi data tersimpan".' : d.link_error === 'decode_gagal' ? 'Tautan ini tidak dapat didekode.' : 'Alamat penerbitnya dicari saat Anda menekan "Baca artikel asli".');
  return d.content_html ? '<span class="tag t-green">Tautan bisa dibuka</span> sistem berhasil membaca isinya.' : '<span class="tag t-amber">Belum dibuka</span> isi artikel belum berhasil dibaca.';
}

// Tiga lapis data: MENTAH (semua hasil crawl) -> CLEANED (alamat penerbit valid, bukan konten konsumen) -> RELEVAN (dinilai AI relevan).
// Relevan juga mensyaratkan isi cukup panjang (berita 500 karakter, caption sosmed/video 80). Yang ditampilkan di aplikasi = cleaned yang relevan menurut AI, ditambah cleaned yang belum dinilai AI tetapi teksnya menyebut nama perusahaan (sementara).
function cleanedStatus(d) {
  const addr = d.article_url || d.found_url || d.url || '';
  if (!d.article_url && /^https:\/\/(news\.google\.com|(www\.)?google\.com\/search)/i.test(addr)) return ['t-gray', 'Mentah (belum cleaned)', 'Alamat asli di situs penerbit belum ditemukan, jadi belum dikirim ke AI dan belum tampil di data cleaned.'];
  if (d.content_kind === 'konsumen') return ['t-gray', 'Mentah (disaring)', 'Disaring: AI menilai isinya konten tutorial/promo/lowongan konsumen.'];
  if (d.ai_status === 'ok') {
    if (d.relevant === 1 && !d.company_role) return ['t-amber', 'Cleaned, perlu dinilai ulang AI', 'AI (format penilaian lama) menandai berita ini relevan tetapi tanpa peran perusahaan, jadi belum masuk Relevan dan tidak dihitung dalam rating. Jalankan "Klasifikasi AI ulang" di Task Runner.'];
    if (d.relevant === 1 && d.stage === 1) return ['t-amber', 'Cleaned, isi terlalu pendek', 'AI menilai relevan, tetapi isi yang tersimpan kurang dari batas minimum (berita 500 karakter, caption sosmed/video 80 karakter), jadi belum masuk data relevan. Jalankan "Lengkapi data tersimpan" untuk mengambil isinya.'];
    return d.relevant === 1
      ? ['t-green', 'Relevan (dinilai AI)', 'Cleaned dan AI menilai berita ini relevan dengan perusahaan.']
      : ['t-gray', 'Cleaned, tidak relevan (AI)', 'AI menilai berita ini tidak relevan dengan perusahaan, jadi tidak tampil.'];
  }
  if (d.related === 1 && d.related_via === 'perusahaan') return ['t-amber', 'Cleaned, belum dinilai AI', 'Tampil sementara karena teksnya menyebut nama/alias perusahaan.'];
  return ['t-gray', 'Cleaned, belum dinilai AI', 'Belum dinilai AI dan teksnya tidak menyebut nama/alias perusahaan, jadi belum tampil.'];
}

function renderNews(d) {
  const assessed = d.ai_status === 'ok' && !!d.company_role;
  const tags = Array.isArray(d.risk_tags) ? d.risk_tags : [];
  const fav = d.source_domain ? '<img src="https://www.google.com/s2/favicons?domain=' + encodeURIComponent(d.source_domain) + '&sz=32" width="16" height="16" alt="" referrerpolicy="no-referrer" onerror="this.remove()">' : '';

  // ----- header -----
  $('#nwMeta').innerHTML = fav + '<b>' + esc(d.source_name || d.source_domain || 'Sumber') + '</b><span>·</span><span title="' + esc(fmtDT(d.published_at)) + '">' + esc(fmtDT(d.published_at)) + ' (' + esc(ago(d.published_at)) + ')</span>'
    + '<span>·</span><a class="co-pill" href="#/c/' + esc(d.company_id) + '" onclick="closeNews()">' + esc(d.company_ticker || d.company_name) + '</a>';
  const finalUrl = safeUrl(artUrl(d));
  const exact = Boolean(finalUrl) && finalUrl !== '#' && !finalUrl.startsWith('/go/');
  const openTip = exact ? 'Buka artikel asli di situs penerbit' : 'Alamat penerbit asli belum tersedia';

  if (exact) {
    $('#nwTitle').innerHTML = '<a class="nw-tl" href="' + esc(finalUrl) + '" target="_blank" rel="noopener" title="' + esc(openTip) + '">' + esc(d.title) + '</a>';
    $('#nwOpen').style.display = '';
    $('#nwOpen').href = finalUrl;
    $('#nwOpen').textContent = 'Baca artikel asli ↗';
    $('#nwOpen').title = openTip;
    $('#nwOpen').classList.remove('disabled');
  } else {
    $('#nwTitle').innerHTML = '<span class="nw-tl" title="' + esc(openTip) + '">' + esc(d.title) + '</span>';
    $('#nwOpen').removeAttribute('href');
    $('#nwOpen').textContent = 'Alamat asli belum tersedia';
    $('#nwOpen').title = openTip;
    $('#nwOpen').classList.add('disabled');
  }

  $('#nwCopy').onclick = () => {
    const u = exact ? finalUrl : (d.article_url || '');
    if (!u || /^https:\/\/www\.google\.com\/search\?/i.test(u) || u === '#' || u.startsWith('/go/')) {
      return toast('Alamat artikel penerbit belum tersedia.', 4000);
    }
    if (/^https:\/\/news\.google\.com\//.test(u)) return toast('Alamat penerbit belum diketahui.', 4000);
    navigator.clipboard?.writeText(u).then(() => toast('Tautan disalin.'), () => toast('Gagal menyalin tautan.'));
  };

  // ----- chip ringkas -----
  const chips = [];
  if (!assessed) chips.push('<span class="tag t-amber" title="AI belum membaca isi berita ini">Belum dinilai AI</span>');
  else {
    chips.push(d.impact === 'buruk' ? '<span class="tag t-red">▼ Risiko bagi debitur</span>' : d.impact === 'baik' ? '<span class="tag t-green">▲ Katalis positif</span>' : '<span class="tag t-gray">Netral</span>');
    if (tags[0]) chips.push('<span class="tag ' + (tags[0].severity >= 4 ? 't-red' : tags[0].severity >= 3 ? 't-amber' : 't-gray') + '">' + esc(NW_CAT[tags[0].cat] || tags[0].cat) + ' · ' + tags[0].severity + '/5</span>');
    if (d.category === 'rumor') chips.push('<span class="tag t-amber">Rumor</span>');
  }
  if (d.credibility_tier === 'official') chips.push('<span class="tag t-green">✓ Sumber resmi</span>');
  if (d.content_truncated) chips.push('<span class="tag t-amber" title="Isi artikel yang tersimpan berhenti di tengah (kemungkinan dibatasi penerbit/paywall). Buka artikel asli untuk membaca lengkap.">Isi terpotong</span>');
  if (Array.isArray(d.juga_dimuat) && d.juga_dimuat.length) chips.push('<span class="tag t-cyan" title="Berita yang sama juga dimuat media lain (daftarnya di bagian bawah). Hanya satu yang disimpan sebagai berita.">Juga dimuat di ' + d.juga_dimuat.length + ' media</span>');
  if (d.credibility_tier === 'corporate') chips.push('<span class="tag t-gray" title="Situs/siaran pers perusahaan atau situs komersial: bukan pihak ketiga yang independen.">Situs perusahaan</span>');
  else if (d.credibility_tier === 'aggregator') chips.push('<span class="tag t-gray" title="Agregator/situs non-redaksi: periksa sumber aslinya.">Agregator</span>');
  if (NW_PLAT[d.platform] && d.platform !== 'berita' && d.platform !== 'resmi') chips.push('<span class="tag t-cyan">' + esc(NW_PLAT[d.platform]) + '</span>');

  // ----- ringkasan AI -----
  const summary = assessed
    ? '<div class="nw-sum"><div class="nw-sum-h">' + AI_MINI + '<b>Ringkasan</b></div><div>' + (d.ai_summary ? esc(d.ai_summary) : '<span class="muted">AI tidak membuat ringkasan.</span>') + '</div>'
      + (d.impact_reason ? '<div class="nw-why"><b>Dampak:</b> ' + esc(d.impact_reason) + '</div>' : '') + '</div>'
    : '<div class="nw-sum pending"><div class="nw-sum-h"><b>Belum dinilai AI</b></div><div class="muted">Dampak dan risiko berita ini belum tersedia. Jalankan “Klasifikasi AI ulang” di Task Runner, atau tekan <b>Tanya AI</b> di atas untuk meminta penjelasan.</div></div>';

  // ----- isi berita -----
  const body = nwSafeBody(d.content_html);
  const bodyHtml = body
    ? '<div class="nw-text clamp" id="nwText">' + body + '</div>' + (d.content_truncated ? '<div class="muted sm" style="margin-top:6px">⚠ Isi artikel tampak terpotong (kemungkinan dibatasi penerbit). Klik “Baca artikel asli” untuk versi lengkapnya.</div>' : '') + '<button type="button" class="nw-more" id="nwMore" hidden>Baca selengkapnya ▾</button>'
    : d.snippet ? '<div class="nw-text"><p>' + esc(d.snippet) + '</p></div><div class="sm dim" style="margin-top:6px">Hanya cuplikan. Isi lengkap belum diambil; buka artikel asli untuk membacanya.</div>'
    : '<div class="muted sm">Tidak ada isi yang tersimpan. Buka artikel asli untuk membacanya.</div>';

  // ----- temuan risiko -----
  const findings = tags.length
    ? '<div class="nw-sec"><h5>Temuan risiko ' + AI_MINI + '</h5>' + tags.map((t) => '<div class="nw-find"><div><b>' + esc(NW_CAT[t.cat] || t.cat) + '</b><div class="nw-sev" title="Tingkat ' + t.severity + ' dari 5 (' + esc(NW_SEV[t.severity] || '') + ')">'
      + [1, 2, 3, 4, 5].map((i) => '<i class="' + (i <= t.severity ? 'on s' + Math.min(t.severity, 5) : '') + '"></i>').join('') + '<span>' + esc(NW_SEV[t.severity] || '') + ' · ' + t.severity + '/5</span></div></div>'
      + '<blockquote>“' + esc(t.hit) + '”</blockquote></div>').join('') + '<div class="sm dim">Kutipan di atas diperiksa sistem: hanya yang benar-benar ada di teks artikel yang ditampilkan.</div></div>'
    : assessed ? '<div class="nw-sec"><h5>Temuan risiko ' + AI_MINI + '</h5><div class="muted sm">AI tidak menemukan temuan risiko pembiayaan pada berita ini.</div></div>' : '';

  // ----- penilaian AI (ringkas) -----
  const cell = (k, v, hint) => '<div><small' + (hint ? ' title="' + esc(hint) + '"' : '') + '>' + esc(k) + '</small><b>' + v + '</b></div>';
  const aiBox = assessed
    ? '<div class="nw-sec"><h5>Penilaian AI ' + AI_MINI + '</h5><div class="nw-grid">'
      + cell('Peran perusahaan', esc(NW_ROLE[d.company_role] || '–'), NW_ROLE_HINT[d.company_role])
      + cell('Jenis informasi', esc(NW_INFO[d.category] || d.category || '–'))
      + cell('Sentimen', esc(NW_SENT[d.sentiment] || d.sentiment || '–'))
      + cell('Keyakinan AI', d.confidence == null ? '–' : d.confidence + '%', 'Seberapa yakin AI pada penilaiannya (0–100%)')
      + '</div>' + (d.reason ? '<div class="nw-why" style="margin-top:10px"><b>Inti bahasan:</b> ' + esc(d.reason) + '</div>' : '')
      + '<div class="sm dim" style="margin-top:8px">Dibuat AI dari isi artikel ini, belum diaudit manusia. Anggap sebagai petunjuk apa yang perlu diverifikasi, bukan keputusan kredit.</div></div>'
    : '';

  // ----- sumber -----
  const srcBox = '<div class="nw-sec"><h5>Tentang sumber</h5><div class="nw-grid">'
    + cell('Penerbit', esc(d.source_name || d.source_domain || '–'))
    + cell('Jenis sumber', esc(NW_TIER[d.credibility_tier] || '–'), 'Dinilai dari domain situs dengan aturan tetap (bukan AI)')
    + cell('Skor kredibilitas', d.credibility_score == null ? '–' : d.credibility_score + ' / 100', 'Aturan tetap berdasarkan domain; mengukur jenis sumber, bukan kebenaran isi berita ini')
    + '</div></div>';

  // ----- media lain yang memuat berita yang sama (duplikat yang ditolak atau digantikan; tidak disimpan sebagai berita sendiri) -----
  const alsoList = Array.isArray(d.juga_dimuat) ? d.juga_dimuat : [];
  const alsoBox = alsoList.length
    ? '<div class="nw-sec"><h5>Juga dimuat di ' + alsoList.length + ' media lain</h5><div class="sm dim" style="margin-bottom:8px">Berita yang sama (judul sama atau mirip) dari penerbit lain. Hanya satu yang disimpan sebagai berita supaya tidak dihitung ganda; yang lain dicatat di sini.</div>'
      + alsoList.map((e) => {
        const ok = /^https?:\/\//i.test(e.url || '');
        return '<div class="nw-also"><div>' + (ok ? '<a class="nw-lnk" href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.domain || e.url) + '</a>' : '<b>' + esc(e.domain || '–') + '</b>')
          + ' <span class="tag t-gray">' + esc(NW_TIER[e.tier] || 'jenis sumber tidak tercatat') + (e.score != null ? ' · ' + esc(e.score) : '') + '</span>'
          + (e.at ? ' <span class="sm muted">terlihat ' + esc(fmtDT(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(e.at) ? e.at.replace(' ', 'T') + 'Z' : e.at)) + '</span>' : '') + '</div>'
          + (e.title ? '<div class="sm muted">“' + esc(e.title) + '”</div>' : '') + '</div>';
      }).join('') + '</div>'
    : '';

  // ----- detail teknis -----
  const [stCls, stLabel, stWhy] = cleanedStatus(d);
  const adapterNames = (d.adapters || []).map((a) => NW_SRC[a] || a).join(' + ');
  const via = Array.isArray(d.found_via) && d.found_via.length
    ? d.found_via.map((v) => '<div class="nw-q"><b>' + esc(NW_SRC[v.src] || v.src || 'sumber tidak tercatat') + '</b>' + (v.q ? '<div class="mono">' + esc(v.q) + '</div>' : '')
      + '<div class="sm muted">kata kunci: ' + esc(v.keyword || '–') + ' · modifier: ' + esc(NW_MOD[v.modifier] || v.modifier || '–') + '</div></div>').join('')
    : '<div class="muted sm">Jejak query tidak tercatat. Kata kunci yang cocok: <b>' + esc(d.keyword || '–') + '</b></div>';
  const relTxt = d.related === 0 ? 'Teks belum menyebut perusahaan maupun pemangku kepentingannya'
    : d.related_via === 'perusahaan' ? 'Teks menyebut nama/alias perusahaan' : 'Teks menyebut pemangku kepentingan: ' + esc(String(d.related_via || '').replace('stakeholder: ', ''));
  const signals = Array.isArray(d.risk_signals) && d.risk_signals.length ? d.risk_signals.map((x) => '<span class="tag t-gray">' + esc(typeof x === 'string' ? x : JSON.stringify(x)) + '</span>').join(' ') : '<span class="muted">tidak ada</span>';
  const tech = '<details class="nw-tech"><summary>Detail teknis</summary><div class="nw-kv">'
    + nwRow('Status data cleaned', '<span class="tag ' + stCls + '">' + esc(stLabel) + '</span> <span class="sm muted">' + esc(stWhy) + '</span>')
    + nwRow('Keterkaitan nama', esc(relTxt)) + nwRow('Relevan menurut AI', yn(d.relevant))
    + nwRow('Diambil oleh', '<b>' + esc(adapterNames) + '</b>' + (d.adapters_inferred ? ' <span class="muted sm">(diperkirakan dari bentuk tautan)</span>' : ''))
    + '<div class="nw-lbl">Query yang menemukannya</div>' + via
    + nwRow('Sinyal risiko (AI)', signals) + nwRow('Topik (AI)', esc(d.topic || '–'))
    + nwRow('Terlihat di crawl', (d.seen_count || 1) + ' kali · pertama ' + esc(fmtDT(d.fetched_at)) + (d.last_seen_at ? ' · terakhir ' + esc(fmtDT(d.last_seen_at)) : ''))
    + nwRow('Platform / jenis', esc((NW_PLAT[d.platform] || d.platform) + ' / ' + (NW_KIND[d.content_kind] || d.content_kind)))
    + nwRow('Status AI', esc(d.ai_status) + (d.ai_error ? ' <span class="mono">' + esc(d.ai_error) + '</span>' : ''))
    + nwRow('Status tautan', linkStatus(d)) + nwRow('ID berita', d.id) + nwRow('Tautan artikel', exact ? '<a class="mono nw-lnk" href="' + esc(finalUrl) + '" target="_blank" rel="noopener">' + esc(finalUrl.startsWith('/go/') ? (d.article_url || d.url) : finalUrl) + '</a>' : '<span class="muted">alamat penerbit belum diketahui</span>') + nwRow('Gambar', d.image_url ? (/^https?:\/\//i.test(d.image_url) ? '<a class="mono nw-lnk" href="' + esc(d.image_url) + '" target="_blank" rel="noopener">' + esc(d.image_url) + '</a>' : '<span class="mono">' + esc(d.image_url) + '</span>') : '–')
    + '</div></details>';

  const img = d.image_url ? '<div class="nw-img"><img src="/img/' + d.id + '" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>' : '';
  // tab per perusahaan: satu artikel yang relevan untuk beberapa perusahaan, penilaian AI-nya per perusahaan
  const sib = Array.isArray(d.kembar) ? d.kembar : [];
  const sibTabs = sib.length > 1 ? '<div class="nw-tabs" role="tablist" title="Artikel yang sama relevan untuk beberapa perusahaan::Isi artikelnya sama, tetapi penilaian AI (peran, dampak, temuan risiko) dihitung per perusahaan. Pilih tab untuk melihat penilaian tiap perusahaan."><span class="sm dim">Dinilai untuk:</span>'
    + sib.map((c) => { const vis = typeof LAYER === 'undefined' || LAYER === 'mentah' || (LAYER === 'cleaned' ? c.stage >= 1 : c.stage === 2); return '<button type="button" class="nw-tab' + (c.id === d.id ? ' on' : '') + (vis ? '' : ' off') + '" role="tab" aria-selected="' + (c.id === d.id) + '" data-tab-nid="' + c.id + '" title="' + esc(c.company_name + ' · dampak: ' + (c.impact || 'belum dinilai AI') + (vis ? '' : ' · belum masuk lapis yang dipilih untuk perusahaan ini')) + '"><i style="background:' + (typeof IMP_DOT !== 'undefined' && IMP_DOT[c.impact] ? IMP_DOT[c.impact] : 'transparent') + '"></i>' + esc(c.label) + '</button>'; }).join('') + '</div>' : '';
  $('#nwBody').innerHTML = sibTabs + img + '<div class="nw-chips">' + chips.join('') + '</div>' + summary
    + '<div class="nw-sec"><h5>Isi berita</h5>' + bodyHtml + '</div>' + findings + aiBox + srcBox + alsoBox + tech;
  $('#nwBody').scrollTop = 0;
  $('#nwBody').querySelectorAll('[data-tab-nid]').forEach((b) => { b.onclick = () => { if (Number(b.dataset.tabNid) !== d.id) openNews(Number(b.dataset.tabNid)); }; });

  // "Baca selengkapnya" hanya bila isinya memang lebih panjang dari kotaknya
  const tx = $('#nwText'), more = $('#nwMore');
  if (tx && more && tx.scrollHeight > tx.clientHeight + 8) {
    more.hidden = false;
    more.onclick = () => { const open = tx.classList.toggle('clamp'); more.textContent = open ? 'Baca selengkapnya ▾' : 'Ringkas ▴'; };
  } else if (tx) tx.classList.remove('clamp');
}

async function openNews(id) {
  $('#nwModal').hidden = false;
  window.__nwId = id;                                   // konteks asisten AI: berita yang sedang dibuka
  window.dispatchEvent(new Event('ms-context'));
  $('#nwTitle').textContent = 'Memuat…'; $('#nwMeta').innerHTML = '';
  $('#nwBody').innerHTML = '<div class="muted" style="padding:20px 0">Memuat detail berita…</div>';
  try { renderNews(await api('/api/news/' + encodeURIComponent(id))); window.dispatchEvent(new Event('ms-context')); }   // judul sudah terisi: perbarui label konteks asisten
  catch (e) { $('#nwTitle').textContent = 'Gagal memuat'; $('#nwBody').innerHTML = '<div class="empty"><b>Gagal memuat detail</b>' + esc(e.message) + '</div>'; }
}
function closeNews() { $('#nwModal').hidden = true; window.__nwId = null; window.dispatchEvent(new Event('ms-context')); }

// Klik di mana pun pada kartu/baris berita membuka modal.
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
// Tombol AI di atas modal: membuka jendela chat asisten di luar modal, sudah berkonteks berita ini (tanpa mengirim pertanyaan otomatis).
$('#nwAskTop').onclick = () => { if (window.assistantOpen) window.assistantOpen(); };
$('#nwModal').addEventListener('click', (e) => { if (e.target.id === 'nwModal') closeNews(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#nwModal').hidden) closeNews(); });

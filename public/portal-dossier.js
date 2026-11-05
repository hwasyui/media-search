/* Tab "Dossier Korporasi" untuk due diligence & FAP (hanya tampilan; data dan ekstraksinya ada di src/dossier.js dan tidak diubah).
   Memakai helper global portal.html: $, esc, api, CS, safeUrl, toast. Angka rujukan memakai gaya .ref dan membuka modal berita (data-nid). */
'use strict';

(() => {
  const css = document.createElement('style');
  css.textContent = `
  .dz-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;padding:20px 22px;border:1px solid var(--line2);border-radius:14px;background:linear-gradient(135deg,rgba(76,141,255,.10),rgba(251,191,36,.05) 70%,transparent);margin-bottom:14px}
  .dz-hero h3{margin:0 0 6px;font-size:20px;letter-spacing:-.01em} .dz-hero p{margin:0;color:var(--muted);line-height:1.6;font-size:13.5px;max-width:760px}
  .dz-meta{margin-top:10px;font-size:12px;color:var(--dim)}
  .dz-kpis{display:flex;gap:10px;align-items:stretch;flex-wrap:wrap}
  .dz-kpi{min-width:104px;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel)} .dz-kpi small{display:block;color:var(--muted);font-size:11.5px} .dz-kpi b{font-size:24px;font-variant-numeric:tabular-nums;line-height:1.2}
  .dz-legend{display:flex;gap:10px 18px;flex-wrap:wrap;align-items:center;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel);font-size:12.5px;color:var(--muted);margin-bottom:16px}
  .dz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,430px),1fr));gap:16px;align-items:start}
  .dz-card{border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden}
  .dz-ch{display:flex;gap:12px;align-items:flex-start;padding:16px 18px 14px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.025),transparent)}
  .dz-ic{width:38px;height:38px;flex:none;display:grid;place-items:center;border-radius:11px;color:var(--text);background:var(--c-bg,rgba(76,141,255,.14));border:1px solid var(--c-bd,rgba(76,141,255,.35))}
  .dz-ic svg,.dz-mi svg,.dz-empty .ic svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .dz-mi{display:inline-flex;vertical-align:-4px;margin-right:8px;font-style:normal}
  .dz-ch h4{margin:0;font-size:15.5px;line-height:1.3} .dz-ch p{margin:3px 0 0;font-size:12.5px;color:var(--muted);line-height:1.5}
  .dz-n{margin-left:auto;flex:none;min-width:30px;height:26px;padding:0 9px;border-radius:999px;display:grid;place-items:center;font:700 12px ui-monospace,Menlo,monospace;background:var(--bg);border:1px solid var(--line2);color:var(--muted)} .dz-n.has{color:var(--text);border-color:var(--c-bd,var(--cyan))}
  .dz-body{padding:12px 14px 14px;display:flex;flex-direction:column;gap:10px}
  .dz-it{border:1px solid var(--line);border-radius:12px;background:var(--bg);padding:12px 14px;display:flex;flex-direction:column;gap:8px}
  .dz-it:hover{border-color:var(--line2)}
  .dz-t{font-weight:700;font-size:14.5px;line-height:1.4;color:var(--text)}
  .dz-sub{display:flex;gap:6px 8px;flex-wrap:wrap;align-items:center;font-size:13px;color:var(--muted);line-height:1.5}
  .dz-pill{display:inline-flex;align-items:center;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;background:rgba(47,191,113,.12);color:var(--green);border:1px solid rgba(47,191,113,.3)}
  .dz-pill.role{background:rgba(76,141,255,.12);color:var(--cyan);border-color:rgba(76,141,255,.3)} .dz-pill.date{background:var(--panel2);color:var(--muted);border-color:var(--line2);font-weight:600}
  .dz-q{margin:0;padding:8px 12px;border-left:3px solid var(--line2);background:rgba(255,255,255,.025);color:#aab2bf;font-size:12.5px;line-height:1.6;border-radius:0 8px 8px 0;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;cursor:pointer}
  .dz-q.open{-webkit-line-clamp:unset;display:block}
  .dz-f{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
  .dz-src{display:inline-flex;align-items:center;gap:7px;padding:3px 10px 3px 4px;border:1px solid var(--line2);border-radius:999px;color:var(--text);font-size:12px;text-decoration:none;max-width:100%} .dz-src:hover{border-color:var(--cyan)} .dz-src span.nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}
  .dz-src.none{color:var(--muted);padding-left:10px;cursor:default}
  .dz-empty{display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px dashed var(--line2);border-radius:12px;color:var(--muted);font-size:13px;line-height:1.55}
  .dz-empty b{display:block;color:var(--text);font-size:13px;margin-bottom:2px} .dz-empty .ic{opacity:.6;flex:none;display:grid}
  .dz-refs summary{cursor:pointer;font-weight:700;padding:13px 16px} .dz-rl{padding:0 16px 12px} .dz-rr{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;padding:9px 0;border-top:1px solid var(--line);font-size:13px}
  .dz-rr a{color:var(--text);text-decoration:none;font-weight:600} .dz-rr a:hover{color:var(--cyan)} .dz-rr small{color:var(--muted);white-space:nowrap}
  .dz-start{padding:38px 24px;text-align:center;border:1px solid var(--line2);border-radius:16px;background:linear-gradient(135deg,rgba(76,141,255,.08),transparent)}
  .dz-start h3{margin:6px 0 10px;font-size:22px} .dz-start p{max-width:620px;margin:0 auto 22px;color:var(--muted);line-height:1.7}
  .dz-parts{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:0 auto 22px;max-width:700px} .dz-parts span{padding:6px 14px;border:1px solid var(--line2);border-radius:999px;font-size:13px;background:var(--panel)}
  @media (max-width:760px){.dz-hero{grid-template-columns:1fr}.dz-kpi{flex:1}}`;
  document.head.appendChild(css);
})();

const DZ_SECTIONS = [
  { key: 'pemilik_manfaat', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><circle cx="12" cy="10" r="2.2"/><path d="M8.5 16c.8-1.8 2-2.5 3.5-2.5s2.7.7 3.5 2.5"/></svg>', title: 'Pemilik Manfaat & Pengendali', sub: 'Siapa pemegang saham pengendali (PSP) dan pemilik manfaat akhir (UBO) di balik perusahaan.', c: ['rgba(251,191,36,.14)', 'rgba(251,191,36,.4)'], need: 'Akta pendirian/perubahan, SK Kemenkumham (AHU), dan daftar pemegang saham.',
    map: (it) => ({ title: it.nama, role: it.peran_atau_porsi || 'Pengendali / pemilik' }) },
  { key: 'klien_proyek', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="12" rx="1"/><path d="M9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8"/><path d="M3 13h18"/></svg>', title: 'Klien Utama & Proyek', sub: 'Pemberi kerja (bowheer), mitra, dan kontrak yang menjadi sumber pendapatan.', c: ['rgba(76,141,255,.14)', 'rgba(76,141,255,.4)'], need: 'PO, kontrak kerja, atau invoice debitur.',
    map: (it) => ({ title: it.klien_mitra, text: it.proyek_kontrak, value: it.nilai, valueLabel: 'Nilai' }) },
  { key: 'akta_korporasi', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 12h5M10 16h5"/></svg>', title: 'Akta & Perubahan Korporasi', sub: 'Pendirian, perubahan anggaran dasar, pengurus, dan aksi korporasi (RUPS, divestasi, akuisisi).', c: ['rgba(47,191,113,.13)', 'rgba(47,191,113,.4)'], need: 'Akta perubahan notaris dan SK Kemenkumham (AHU).',
    map: (it) => ({ title: it.peristiwa, date: it.tanggal, text: it.rincian }) },
  { key: 'fasilitas_bank', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10l9-6 9 6"/><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8"/><path d="M3 20h18"/></svg>', title: 'Fasilitas Bank & Pinjaman', sub: 'Kreditur, jenis fasilitas, dan plafon kredit yang sudah ada.', c: ['rgba(94,242,255,.12)', 'rgba(94,242,255,.38)'], need: 'SLIK OJK dan surat perjanjian kredit.',
    map: (it) => ({ title: it.kreditor_bank, text: it.jenis_fasilitas, value: it.plafon, valueLabel: 'Plafon' }) },
];

async function tabDossier() {
  const c = CS.data.company;
  $('#cbody').innerHTML = '<div class="muted" style="padding:24px 0">Memuat dossier korporasi…</div>';

  let d = null;
  try {
    const res = await api('/api/company/' + encodeURIComponent(c.id) + '/dossier');
    d = res.dossier;
  } catch (e) {
    $('#cbody').innerHTML = '<div class="empty"><b>Gagal memuat dossier</b>' + esc(e.message) + '</div>';
    return;
  }

  if (CS.tab !== 'dossier' || CS.data.company.id !== c.id) return;

  if (!d) {
    $('#cbody').innerHTML = `
      <div class="dz-start">
        <div class="eyebrow" style="color:var(--cyan)">DOSSIER KORPORASI</div>
        <h3>Dossier belum dibuat</h3>
        <p>AI membaca isi berita yang sudah tersimpan dan menyusun empat bagian kunci untuk due diligence. Setiap poin wajib punya rujukan berita dan kutipan asli; yang tidak ada di berita tidak diisi.</p>
        <div class="dz-parts">${DZ_SECTIONS.map((s) => `<span><i class="dz-mi">${s.icon}</i>${esc(s.title)}</span>`).join('')}</div>
        <button class="btn wht" id="btnExtractDossier" style="padding:11px 24px;font-weight:700">Buat dossier dari berita</button>
      </div>`;
    $('#btnExtractDossier').onclick = () => refreshDossier(c.id);
    return;
  }

  renderDossierView(d, c);
}

function renderDossierView(d, c) {
  const s = d.sections || {};
  const refs = d.refs || [];
  const refBy = new Map(refs.map((r) => [r.n, r]));
  const stats = d.stats || { total_items: 0, verified_count: 0, unverified_count: 0 };
  const genDate = d.generated_at ? new Date(d.generated_at).toLocaleString('id-ID') : '-';

  const status = (st) => (st === 'terverifikasi_dokumen'
    ? '<span class="tag t-green" title="Terverifikasi dokumen::Berasal dari dokumen resmi (akta, keterbukaan bursa, atau profil resmi), bukan sekadar berita.">✓ Terverifikasi dokumen</span>'
    : '<span class="tag t-amber" title="Dari berita, belum diverifikasi::Diekstrak dari isi berita. Cocokkan dengan dokumen asli (akta, AHU, SLIK) sebelum dipakai.">Dari berita · belum diverifikasi</span>');

  // Chip sumber: nomor berita + nama media; klik membuka modal beritanya
  const source = (it) => {
    const r = it.ref_n ? refBy.get(it.ref_n) : null;
    if (!r && !it.url) return `<span class="dz-src none" title="Sumber::Berasal dari profil perusahaan yang diisi manual, bukan dari berita.">${esc(it.dasar || 'Profil perusahaan')}</span>`;
    const url = (r && r.url) || it.url, nid = r && r.id;
    const name = (r && r.source) || it.source_name || 'Sumber';
    const tip = (r ? r.title : name) + '::' + [name, r && r.date].filter(Boolean).join(' · ') + ' — klik untuk membuka beritanya.';
    return `<a class="dz-src" href="${esc(safeUrl(url))}" ${nid ? 'data-nid="' + nid + '"' : ''} target="_blank" rel="noopener" title="${esc(tip)}">${it.ref_n ? `<span class="ref">${it.ref_n}</span>` : ''}<span class="nm">${esc(name)}</span></a>`;
  };

  const item = (sec, it) => {
    const m = sec.map(it);
    return `<div class="dz-it">
      <div class="dz-t">${esc(m.title || '-')}</div>
      <div class="dz-sub">${m.role ? `<span class="dz-pill role">${esc(m.role)}</span>` : ''}${m.date ? `<span class="dz-pill date">${esc(m.date)}</span>` : ''}${m.text ? `<span>${esc(m.text)}</span>` : ''}${m.value ? `<span class="dz-pill" title="${esc(m.valueLabel)}::Angka seperti yang tertulis di berita; belum dicek ke dokumen.">${esc(m.valueLabel)} ${esc(m.value)}</span>` : ''}</div>
      ${it.kutipan_asli ? `<blockquote class="dz-q" title="Kutipan asli dari berita::Klik untuk membuka/menutup seluruh kutipan.">“${esc(it.kutipan_asli)}”</blockquote>` : ''}
      <div class="dz-f">${status(it.status_verifikasi)}${source(it)}</div>
    </div>`;
  };

  const card = (sec) => {
    const data = s[sec.key] || {};
    const items = data.data_tersedia && data.items?.length ? data.items : [];
    const body = items.length
      ? items.map((it) => item(sec, it)).join('')
      : `<div class="dz-empty"><span class="ic"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M8.5 12h7"/></svg></span><div><b>Belum ada data di berita</b>${esc(data.pesan_kosong || 'Belum ada data untuk bagian ini.')}<div class="sm dim" style="margin-top:6px">Dokumen yang dibutuhkan: ${esc(sec.need)}</div></div></div>`;
    return `<section class="dz-card" style="--c-bg:${sec.c[0]};--c-bd:${sec.c[1]}">
      <div class="dz-ch"><span class="dz-ic">${sec.icon}</span><div style="min-width:0"><h4>${esc(sec.title)}</h4><p>${esc(sec.sub)}</p></div><span class="dz-n ${items.length ? 'has' : ''}" title="Jumlah temuan di bagian ini">${items.length}</span></div>
      <div class="dz-body">${body}</div></section>`;
  };

  const refsHtml = refs.length ? `
    <details class="card tbl dz-refs" style="margin-top:18px">
      <summary>Daftar berita yang dirujuk (${refs.length})</summary>
      <div class="dz-rl"><div class="sm dim" style="padding-bottom:8px">Angka pada kartu di atas adalah nomor berita pada daftar ini. Klik untuk membuka beritanya.</div>
        ${refs.map((r) => `<div class="dz-rr"><span class="ref">${r.n}</span><a href="${esc(safeUrl(r.url))}" ${r.id ? 'data-nid="' + r.id + '"' : ''} target="_blank" rel="noopener">${esc(r.title)}</a><small>${esc(r.source || '')}${r.date ? ' · ' + esc(r.date) : ''}</small></div>`).join('')}
      </div>
    </details>` : '';

  $('#cbody').innerHTML = `
    <div class="dz-hero">
      <div>
        <div class="eyebrow" style="color:var(--cyan);margin-bottom:4px">DOSSIER KORPORASI · DUE DILIGENCE</div>
        <h3>Struktur, klien, akta, dan fasilitas bank</h3>
        <p>${esc(d.ringkasan || '')}</p>
        <div class="dz-meta">Diperbarui ${esc(genDate)} · disusun dari ${stats.news_analyzed || refs.length} berita dan profil perusahaan</div>
      </div>
      <div class="dz-kpis">
        <div class="dz-kpi"><small>Total temuan</small><b>${stats.total_items}</b></div>
        <div class="dz-kpi" title="Terverifikasi dokumen::Temuan yang berasal dari dokumen resmi."><small>Terverifikasi</small><b style="color:var(--green)">${stats.verified_count}</b></div>
        <div class="dz-kpi" title="Dari berita::Temuan dari isi berita yang masih perlu dicocokkan dengan dokumen asli."><small>Dari berita</small><b style="color:var(--amber)">${stats.unverified_count}</b></div>
        <button class="btn wht" id="btnExtractDossier" style="align-self:center">⟳ Buat ulang</button>
      </div>
    </div>
    <div class="dz-legend">
      <span>${status('terverifikasi_dokumen')}</span><span>${status('dari_berita')}</span>
      <span>Setiap poin menyertakan <b style="color:var(--text)">kutipan asli</b> dan <b style="color:var(--text)">nomor berita</b> yang bisa diklik. Yang tidak ditemukan di berita dibiarkan kosong, tidak diisi tebakan.</span>
    </div>
    <div class="dz-grid">${DZ_SECTIONS.map(card).join('')}</div>
    ${refsHtml}`;

  // kutipan panjang: klik untuk membuka/menutup
  $('#cbody').querySelectorAll('.dz-q').forEach((q) => (q.onclick = () => q.classList.toggle('open')));
  $('#btnExtractDossier').onclick = () => refreshDossier(c.id);
}

async function refreshDossier(companyId) {
  const btn = $('#btnExtractDossier');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Menyusun dari berita…';
  }
  toast('Sedang menyusun dossier korporasi dari berita lengkap…', 4000);
  try {
    const res = await api('/api/company/' + encodeURIComponent(companyId) + '/dossier', {
      method: 'POST',
    });
    toast('Dossier korporasi berhasil diperbarui!');
    renderDossierView(res.dossier, CS.data.company);
  } catch (e) {
    toast('Gagal menyusun dossier: ' + e.message, 8000);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Coba lagi';
    }
  }
}

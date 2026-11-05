/* Penjelajah berita (dipakai di Beranda dan tab Berita perusahaan).
   Susunan: bilah alat (cari, perusahaan, waktu, urutan, filter; semua kotak setinggi sama) -> chip filter aktif -> hasil. Tanpa tab (dobel dengan filter) dan tanpa mode data mentah.
   Filter lanjutan berupa tombol pilihan (pill) dengan jumlah per pilihan; klik lagi untuk melepas. "Muat lebih banyak" menambah kartu di bawah tanpa
   menggambar ulang halaman. Memakai helper global portal.html: $, esc, api, newsCard, sideRow, leadCard, tabsHtml, S, CS. */
'use strict';

const SORT_OPTS = [['mix', 'Rekomendasi'], ['latest', 'Terbaru'], ['oldest', 'Terlama'], ['risk', 'Risiko tertinggi'], ['credibility', 'Sumber paling kredibel'], ['seen', 'Paling sering muncul']];
const DAYS_OPTS = [['7', '7 hari terakhir'], ['14', '14 hari terakhir'], ['30', '30 hari terakhir'], ['90', '90 hari terakhir'], ['365', '1 tahun terakhir'], ['0', 'Semua waktu']];
const PAGE = 24;
const LBL = {
  platform: { berita: 'Media massa', blog: 'Blog & forum', sosmed: 'Media sosial', video: 'Video', resmi: 'Sumber resmi' },
  impact: { buruk: 'Risiko', baik: 'Katalis positif', netral: 'Netral' },
  riskCat: { hukum: 'Hukum & perkara', keuangan: 'Keuangan & pembayaran', integritas: 'Integritas & fraud', kepemilikan: 'Kepemilikan & pengurus', operasional: 'Operasional', regulasi: 'Regulasi & sanksi', reputasi: 'Reputasi' },
  ai: { assessed: 'Sudah dinilai AI', pending: 'Belum dinilai AI' },
  riskMin: { 2: 'Risiko ≥ 2', 3: 'Risiko sedang ke atas (≥ 3)', 4: 'Risiko tinggi (≥ 4)', 5: 'Risiko sangat tinggi (5)' },
};
// Kelompok pilihan di panel filter: [kunci state, judul, kunci facet, nama parameter API, petunjuk]
const PILL_GROUPS = [
  ['impact', 'Dampak (dinilai AI)', 'impact', 'impact', 'Penilaian AI atas isi berita: apakah merugikan debitur (Risiko), menguatkan (Katalis positif), atau tidak berpengaruh (Netral).'],
  ['riskCat', 'Kategori risiko', 'riskCat', 'risk_cat', 'Jenis temuan risiko pembiayaan yang AI temukan tertulis di berita, beserta kutipan buktinya.'],
  ['platform', 'Jenis sumber', 'platform', 'platform', ''],
  ['ai', 'Status penilaian AI', 'ai', 'ai', 'Berita yang belum dinilai AI belum punya dampak dan tag risiko, dan belum dihitung dalam rating.'],
];
const newFeedState = () => ({ sort: 'mix', q: '', days: '30', platform: '', impact: '', riskCat: '', riskMin: '', ai: '', source: '', company: '', _adv: false });
const facetCache = new Map();
let exploreToken = 0;

function activeFilters(st, withCompany) {
  const out = [];
  if (st.q) out.push(['q', 'Cari: “' + st.q + '”']);
  if (withCompany && st.company) { const c = (S.portfolio || []).find((x) => x.id === st.company); out.push(['company', c ? c.ticker || c.name : st.company]); }
  for (const [k] of PILL_GROUPS) if (st[k]) out.push([k, LBL[k][st[k]] || st[k]]);
  if (st.riskMin) out.push(['riskMin', LBL.riskMin[st.riskMin] || 'Risiko ≥ ' + st.riskMin]);
  if (st.source) out.push(['source', 'Sumber: ' + st.source]);
  if (st.days !== '30') out.push(['days', (DAYS_OPTS.find((d) => d[0] === st.days) || [0, st.days])[1]]);
  return out;
}

async function loadFacets(st, company) {
  const key = [company || '', st.days].join('|');
  const hit = facetCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.data;
  const qs = new URLSearchParams({ days: st.days }); if (company) qs.set('company', company);
  const data = await api('/api/news/facets?' + qs);
  facetCache.set(key, { at: Date.now(), data });
  return data;
}

const optHtml = (list, cur) => list.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>').join('');
const selHtml = (id, label, list, cur) => '<label class="fc"><span>' + esc(label) + '</span><select id="' + id + '">' + optHtml(list, cur) + '</select></label>';
function pillGroup(st, key, title, hint, entries) {
  if (!entries.length) return '';
  return '<div class="pg"><div class="pg-t" ' + (hint ? 'title="' + esc(title + '::' + hint) + '"' : '') + '>' + esc(title) + (hint ? ' <span class="dim">ⓘ</span>' : '') + '</div><div class="pills">'
    + entries.map(([v, label, n]) => '<button type="button" class="pill' + (String(st[key]) === String(v) ? ' on' : '') + '" data-fk="' + key + '" data-fv="' + esc(v) + '">' + esc(label) + (n != null ? ' <i>' + n + '</i>' : '') + '</button>').join('')
    + '</div></div>';
}
const entriesOf = (key, facet) => Object.entries(facet || {}).filter(([, n]) => n > 0).map(([v, n]) => [v, LBL[key]?.[v] || v, n]);

/* opts: { mount, state, company (id tetap, untuk halaman perusahaan), lead (tata letak berita utama), chips (tampilkan pilihan perusahaan) } */
async function renderExplorer(opts) {
  const token = ++exploreToken;
  const st = Object.assign(newFeedState(), opts.state);
  Object.assign(opts.state, st);
  const company = opts.company || st.company || '';
  const qs = new URLSearchParams({ sort: st.sort, limit: PAGE, days: st.days });
  if (company) qs.set('company', company);
  if (st.q) qs.set('q', st.q);
  for (const [k, , , param] of PILL_GROUPS) if (st[k]) qs.set(param, st[k]);
  if (st.riskMin) qs.set('risk_min', st.riskMin);
  if (st.source) qs.set('source', st.source);

  let data, facets;
  try { [data, facets] = await Promise.all([api('/api/news?' + qs), loadFacets(st, company)]); }
  catch (e) { if (token === exploreToken) opts.mount.innerHTML = '<div class="empty"><b>Gagal memuat berita</b>' + esc(e.message) + '</div>'; return; }
  if (token !== exploreToken) return;
  const { items, total } = data;
  const act = activeFilters(st, Boolean(opts.chips));
  const nFilters = PILL_GROUPS.filter(([k]) => st[k]).length + (st.riskMin ? 1 : 0) + (st.source ? 1 : 0);

  const coOpts = opts.chips ? '<label class="fc"><span>Perusahaan</span><select id="fco"><option value="">Semua perusahaan</option>'
    + (S.portfolio || []).map((c) => '<option value="' + esc(c.id) + '"' + (st.company === c.id ? ' selected' : '') + '>' + esc((c.ticker ? c.ticker + ' · ' : '') + c.name.replace(/^PT\s+/i, '')) + (c.stats && c.stats.total ? ' (' + c.stats.total + ')' : '') + '</option>').join('') + '</select></label>' : '';

  const srcList = [['', 'Semua sumber']].concat(Object.entries(facets.source || {}).map(([d, n]) => [d, d + ' (' + n + ')']));
  const panel = '<div class="fpanel" id="fpanel" ' + (st._adv ? '' : 'hidden') + '>'
    + PILL_GROUPS.map(([k, title, fk, , hint]) => pillGroup(st, k, title, hint, entriesOf(k, facets[fk]))).join('')
    + pillGroup(st, 'riskMin', 'Tingkat risiko minimal', 'Tingkat keparahan tertinggi dari temuan risiko pada berita, skala 1 (ringan) sampai 5 (sangat tinggi).', [['3', LBL.riskMin[3]], ['4', LBL.riskMin[4]], ['5', LBL.riskMin[5]]])
    + '<div class="pg"><div class="pg-t">Sumber (situs)</div><label class="fc wide"><select id="fsrc">' + optHtml(srcList, st.source) + '</select></label></div>'
    + '</div>';

  const bar = '<div class="ftool">'
    + '<div class="fsearch-w fc"><span class="fsi">⌕</span><input id="fq" class="fsearch" type="search" placeholder="Cari judul, isi, atau sumber…" value="' + esc(st.q) + '" autocomplete="off"></div>'
    + coOpts + selHtml('fdays', 'Waktu', DAYS_OPTS, st.days) + selHtml('fsort', 'Urutkan', SORT_OPTS, st.sort)
    + '<button class="btn fbtn' + (nFilters ? ' has' : '') + '" id="fadv" type="button" aria-expanded="' + Boolean(st._adv) + '">⚙ Filter' + (nFilters ? ' <span class="badge">' + nFilters + '</span>' : '') + '</button>'
    + '</div>' + panel
    + (act.length ? '<div class="active">' + act.map(([k, t]) => '<button type="button" class="achip" data-x="' + k + '" title="Lepas filter">' + esc(t) + ' <b>✕</b></button>').join('') + '<button type="button" class="alink" id="freset">Reset semua</button></div>' : '');

  const cards = (arr) => arr.map((r) => newsCard(r, { showCompany: !company })).join('');
  const showLead = opts.lead && st.sort === 'mix' && !st.q && !nFilters && !st.company && items.length >= 5;
  let list;
  if (!items.length) {
    list = '<div class="empty"><b>Tidak ada berita yang cocok</b>' + (act.length ? 'Filter terlalu ketat atau belum ada data untuk pilihan ini.<div style="margin-top:12px"><button class="btn" id="freset2" type="button">Reset semua filter</button></div>'
      : 'Belum ada berita tersimpan. Jalankan crawl di Task Runner.') + '</div>';
  } else if (showLead) {
    const [lead, ...rest] = items;
    list = '<div class="lead">' + leadCard(lead) + '<div class="lead-side"><div class="eyebrow" style="margin:2px 0 0">PILIHAN REDAKSI</div>' + rest.slice(0, 4).map(sideRow).join('') + '</div></div>'
      + '<div class="grid" id="fgrid">' + cards(rest.slice(4)) + '</div>';
  } else {
    list = '<div class="grid" id="fgrid">' + cards(items) + '</div>';
  }
  const sortLbl = (SORT_OPTS.find((s) => s[0] === st.sort) || [0, ''])[1];
  const count = '<div class="fcount" id="fcount"></div>';
  const more = '<div id="fmoreW" style="text-align:center;margin-top:20px"></div>';
  opts.mount.innerHTML = bar + count + list + more;

  // jumlah & tombol "muat lebih banyak" (dipanggil ulang setiap kali kartu ditambah)
  let loaded = items.length, busy = false;
  const paint = () => {
    $('#fcount').innerHTML = items.length || loaded ? 'Menampilkan <b>' + loaded + '</b> dari <b>' + total + '</b> berita · urutan: ' + esc(sortLbl.toLowerCase()) + '' : '';
    $('#fmoreW').innerHTML = loaded < total ? '<button class="btn" id="fmore" type="button">Muat ' + Math.min(PAGE, total - loaded) + ' berita lagi <span class="dim">(sisa ' + (total - loaded) + ')</span></button>' : '';
    const mb = $('#fmoreW #fmore'); if (mb) mb.onclick = loadMore;
  };
  async function loadMore() {
    if (busy) return; busy = true;
    const mb = $('#fmore'); if (mb) { mb.disabled = true; mb.textContent = 'Memuat…'; }
    try {
      const q2 = new URLSearchParams(qs); q2.set('offset', String(loaded)); q2.set('limit', String(PAGE));
      const d = await api('/api/news?' + q2);
      if (token !== exploreToken) return;
      const grid = $('#fgrid');
      if (grid) grid.insertAdjacentHTML('beforeend', cards(d.items));
      loaded += d.items.length;
      if (!d.items.length) loaded = total;       // data berubah: hentikan agar tombol tidak menggantung
    } catch (e) { toast('Gagal memuat: ' + e.message); }
    busy = false; paint();
  }
  paint();

  // ----- interaksi -----
  const again = () => renderExplorer(opts);
  const set = (k, v) => { st[k] = v; opts.state[k] = v; again(); };
  const resetAll = () => { const keep = { _adv: st._adv }; Object.keys(opts.state).forEach((k) => delete opts.state[k]); Object.assign(opts.state, newFeedState(), keep); again(); };
  opts.mount.querySelectorAll('.pill').forEach((b) => (b.onclick = () => set(b.dataset.fk, String(st[b.dataset.fk]) === b.dataset.fv ? '' : b.dataset.fv)));
  const on = (id, fn) => { const el = opts.mount.querySelector('#' + id); if (el) el.onchange = fn; };
  on('fsort', (e) => set('sort', e.target.value)); on('fdays', (e) => set('days', e.target.value)); on('fco', (e) => set('company', e.target.value));
  on('fsrc', (e) => set('source', e.target.value));
  const q = opts.mount.querySelector('#fq');
  let t; q.oninput = (e) => { clearTimeout(t); t = setTimeout(() => set('q', e.target.value.trim()), 450); };
  q.onkeydown = (e) => { if (e.key === 'Enter') { clearTimeout(t); set('q', e.target.value.trim()); } };
  opts.mount.querySelector('#fadv').onclick = (e) => { st._adv = opts.state._adv = !st._adv; opts.mount.querySelector('#fpanel').hidden = !st._adv; e.currentTarget.setAttribute('aria-expanded', st._adv); };
  for (const id of ['freset', 'freset2']) { const b = opts.mount.querySelector('#' + id); if (b) b.onclick = resetAll; }
  opts.mount.querySelectorAll('.achip').forEach((c) => (c.onclick = () => { const k = c.dataset.x; set(k, k === 'days' ? '30' : ''); }));
}

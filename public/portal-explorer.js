/* Penjelajah berita (dipakai di Beranda dan tab Berita perusahaan): tab, pencarian, urutan, dan SEMUA filter yang didukung server,
   lengkap dengan jumlah per pilihan, chip filter aktif, dan paginasi. Memakai helper global portal.html: $, esc, api, newsCard, sideRow, leadCard, tabsHtml, S, CS. */
'use strict';

const SORT_OPTS = [['mix', 'Campuran (relevan + baru)'], ['latest', 'Terbaru'], ['oldest', 'Terlama'], ['risk', 'Risiko tertinggi'], ['credibility', 'Sumber paling kredibel'], ['confidence', 'Keyakinan AI tertinggi'], ['seen', 'Paling sering muncul'], ['relevant', 'Paling relevan (AI)']];
const DAYS_OPTS = [['7', '7 hari'], ['14', '14 hari'], ['30', '30 hari'], ['90', '90 hari'], ['365', '1 tahun'], ['0', 'Semua waktu']];
const LBL = {
  platform: { berita: 'Berita (media massa)', blog: 'Blog & forum', sosmed: 'Media sosial', video: 'Video (YouTube)', resmi: 'Sumber resmi' },
  kind: { resmi: 'Resmi', berita: 'Berita', persepsi_publik: 'Persepsi publik', konsumen: 'Tutorial/konsumen' },
  tier: { official: 'Resmi (instansi/bursa)', mainstream: 'Media massa', social_forum: 'Medsos/forum' },
  impact: { baik: 'Katalis positif', buruk: 'Risiko', netral: 'Netral' },
  sentiment: { positif: 'Positif', netral: 'Netral', negatif: 'Negatif' },
  category: { fakta: 'Fakta', opini: 'Opini', rumor: 'Rumor' },
  riskCat: { hukum: 'Hukum & Perkara', keuangan: 'Keuangan & Pembayaran', integritas: 'Integritas & Fraud', kepemilikan: 'Kepemilikan & Pengurus', operasional: 'Operasional', regulasi: 'Regulasi & Sanksi', reputasi: 'Reputasi' },
  related: { perusahaan: 'Menyebut perusahaan', stakeholder: 'Via pemangku kepentingan', tidak: 'Tidak terkait (data mentah)' },
  ai: { ok: 'Sudah diklasifikasi AI', failed: 'AI gagal', skipped: 'Belum diklasifikasi' },
};
// [kunci state, label, kunci facet, nama parameter API]
const FILTER_DEFS = [
  ['platform', 'Platform', 'platform', 'platform'], ['kind', 'Jenis konten', 'kind', 'kind'], ['tier', 'Kredibilitas sumber', 'tier', 'tier'],
  ['impact', 'Dampak', 'impact', 'impact'], ['category', 'Kategori (AI)', 'category', 'category'], ['sentiment', 'Sentimen (AI)', 'sentiment', 'sentiment'],
  ['riskCat', 'Kategori risiko', 'riskCat', 'risk_cat'], ['related', 'Keterkaitan', 'related', 'related'], ['ai', 'Status AI', 'ai', 'ai'],
];

const newFeedState = () => ({ filter: 'all', sort: 'mix', q: '', days: '30', platform: '', kind: '', tier: '', impact: '', category: '', sentiment: '', riskCat: '', riskMin: '', related: '', ai: '', source: '', raw: false, company: '', limit: 24 });
const facetCache = new Map();
let exploreToken = 0;

function activeFilters(st, withCompany) {
  const out = [];
  for (const [k, label] of FILTER_DEFS) if (st[k]) out.push([k, label + ': ' + (LBL[k][st[k]] || st[k])]);
  if (st.riskMin) out.push(['riskMin', 'Risiko ≥ ' + st.riskMin + '/5']);
  if (st.source) out.push(['source', 'Sumber: ' + st.source]);
  if (st.q) out.push(['q', 'Cari: “' + st.q + '”']);
  if (st.days !== '30') out.push(['days', 'Waktu: ' + ((DAYS_OPTS.find((d) => d[0] === st.days) || [0, st.days])[1])]);
  if (st.raw) out.push(['raw', 'Data mentah']);
  if (withCompany && st.company) { const c = (S.portfolio || []).find((x) => x.id === st.company); out.push(['company', 'Perusahaan: ' + (c ? c.ticker || c.name : st.company)]); }
  return out;
}

function selectHtml(id, label, options, cur, title) {
  return '<label class="fx"><span>' + esc(label) + '</span><select id="' + id + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>' + options.map(([v, l]) => '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>').join('') + '</select></label>';
}
const facetOpts = (st, key, facets, label) => [['', 'Semua ' + label.toLowerCase()]].concat(Object.entries(facets[key] || {}).map(([v, n]) => [v, (LBL[key] ? LBL[key][v] || v : v) + ' (' + n + ')']));

async function loadFacets(st, company) {
  const key = [company || '', st.days, st.raw ? 1 : 0].join('|');
  const hit = facetCache.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.data;
  const qs = new URLSearchParams({ days: st.days }); if (company) qs.set('company', company); if (st.raw) qs.set('raw', '1');
  const data = await api('/api/news/facets?' + qs);
  facetCache.set(key, { at: Date.now(), data });
  return data;
}

/* opts: { mount, state, company (id tetap, untuk halaman perusahaan), lead (tata letak berita utama), chips (chip perusahaan) } */
async function renderExplorer(opts) {
  const token = ++exploreToken;
  const st = Object.assign(newFeedState(), opts.state);
  Object.assign(opts.state, st);
  const company = opts.company || st.company || '';
  const qs = new URLSearchParams({ filter: st.filter, sort: st.sort, limit: st.limit, days: st.days });
  if (company) qs.set('company', company);
  if (st.raw) qs.set('raw', '1');
  if (st.q) qs.set('q', st.q);
  for (const [k, , , param] of FILTER_DEFS) if (st[k]) qs.set(param, st[k]);
  if (st.riskMin) qs.set('risk_min', st.riskMin);
  if (st.source) qs.set('source', st.source);

  let data, facets;
  try { [data, facets] = await Promise.all([api('/api/news?' + qs), loadFacets(st, company)]); }
  catch (e) { if (token === exploreToken) opts.mount.innerHTML = '<div class="empty"><b>Gagal memuat berita</b>' + esc(e.message) + '</div>'; return; }
  if (token !== exploreToken) return;
  const { items, counts, total } = data;
  const act = activeFilters(st, Boolean(opts.chips));
  const advActive = FILTER_DEFS.filter(([k]) => st[k]).length + (st.riskMin ? 1 : 0) + (st.source ? 1 : 0);

  const chipsRow = opts.chips ? '<div class="chips"><button class="chip ' + (st.company ? '' : 'on') + '" data-co="">Semua perusahaan</button>'
    + (S.portfolio || []).map((c) => '<button class="chip ' + (st.company === c.id ? 'on' : '') + '" data-co="' + esc(c.id) + '">' + esc(c.ticker || c.name.replace(/^PT\s+/i, '')) + (c.stats && c.stats.total ? ' · ' + c.stats.total : '') + '</button>').join('') + '</div>' : '';

  const bar = '<div class="fbar">'
    + '<div class="frow"><input id="fq" class="fsearch" type="search" placeholder="Cari judul, isi, atau sumber…" value="' + esc(st.q) + '">'
    + selectHtml('fsort', 'Urutkan', SORT_OPTS, st.sort) + selectHtml('fdays', 'Rentang waktu', DAYS_OPTS, st.days)
    + '<label class="fx chk" title="Tampilkan semua hasil crawl, termasuk yang tidak terkait perusahaan dan konten tutorial/konsumen"><input type="checkbox" id="fraw" ' + (st.raw ? 'checked' : '') + '> Data mentah</label>'
    + '<button class="btn" id="fadv" type="button">Filter lanjutan' + (advActive ? ' <span class="badge">' + advActive + '</span>' : '') + ' ▾</button>'
    + (act.length ? '<button class="btn" id="freset" type="button">Reset</button>' : '') + '</div>'
    + '<div class="fadv" id="fadvBox" ' + (st._adv ? '' : 'hidden') + '>'
    + FILTER_DEFS.map(([k, label, fk]) => selectHtml('f_' + k, label, facetOpts(st, fk, facets, label), st[k])).join('')
    + selectHtml('f_riskMin', 'Risiko minimal', [['', 'Semua tingkat'], ['1', '≥ 1 (ada tag risiko)'], ['2', '≥ 2'], ['3', '≥ 3 (sedang)'], ['4', '≥ 4 (tinggi)'], ['5', '5 (sangat tinggi)']], st.riskMin)
    + selectHtml('f_source', 'Sumber (domain)', [['', 'Semua sumber']].concat(Object.entries(facets.source || {}).map(([d, n]) => [d, d + ' (' + n + ')'])), st.source)
    + '</div>'
    + (act.length ? '<div class="active">' + act.map(([k, t]) => '<span class="achip" data-x="' + k + '">' + esc(t) + ' <b>✕</b></span>').join('') + '</div>' : '')
    + '</div>';

  const showLead = opts.lead && st.sort === 'mix' && st.filter === 'all' && !st.q && !advActive && !st.raw && items.length >= 5;
  let list;
  if (!items.length) {
    list = '<div class="empty"><b>Tidak ada berita yang cocok</b>Coba longgarkan filter' + (act.length ? ' atau tekan Reset' : '') + '.</div>';
  } else if (showLead) {
    const [lead, ...rest] = items;
    list = '<div class="lead">' + leadCard(lead) + '<div class="lead-side"><div class="eyebrow" style="margin:2px 0 0">EDITORIAL CURATION</div>' + rest.slice(0, 4).map(sideRow).join('') + '</div></div>'
      + (rest.length > 4 ? '<div class="grid">' + rest.slice(4).map((r) => newsCard(r)).join('') + '</div>' : '');
  } else {
    list = '<div class="grid">' + items.map((r) => newsCard(r, { showCompany: !company })).join('') + '</div>';
  }
  const more = items.length < total ? '<div style="text-align:center;margin-top:20px"><button class="btn" id="fmore">Muat lebih banyak (' + (total - items.length) + ' lagi)</button></div>' : '';

  opts.mount.innerHTML = tabsHtml(counts, st.filter, 'data-f') + chipsRow + bar
    + '<div class="sm muted" style="margin:10px 0 0">Menampilkan <b style="color:var(--text)">' + items.length + '</b> dari <b style="color:var(--text)">' + total + '</b> berita' + (st.raw ? ' (data mentah)' : ' (cleaned)') + '</div>' + list + more;

  const again = () => renderExplorer(opts);
  const set = (k, v) => { st[k] = v; opts.state[k] = v; opts.state.limit = 24; st.limit = 24; again(); };
  opts.mount.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => set('filter', b.dataset.f)));
  opts.mount.querySelectorAll('[data-co]').forEach((b) => (b.onclick = () => set('company', b.dataset.co)));
  const bind = (id, key, ev = 'onchange') => { const el = opts.mount.querySelector('#' + id); if (el) el[ev] = (e) => set(key, e.target.value); };
  bind('fsort', 'sort'); bind('fdays', 'days'); bind('f_riskMin', 'riskMin'); bind('f_source', 'source');
  for (const [k] of FILTER_DEFS) bind('f_' + k, k);
  opts.mount.querySelector('#fraw').onchange = (e) => set('raw', e.target.checked);
  const q = opts.mount.querySelector('#fq');
  let t; q.oninput = (e) => { clearTimeout(t); t = setTimeout(() => set('q', e.target.value.trim()), 450); };
  q.onkeydown = (e) => { if (e.key === 'Enter') { clearTimeout(t); set('q', e.target.value.trim()); } };
  opts.mount.querySelector('#fadv').onclick = () => { st._adv = opts.state._adv = !st._adv; opts.mount.querySelector('#fadvBox').hidden = !st._adv; };
  const rs = opts.mount.querySelector('#freset');
  if (rs) rs.onclick = () => { const keep = { company: opts.company ? '' : '', _adv: st._adv }; Object.keys(opts.state).forEach((k) => delete opts.state[k]); Object.assign(opts.state, newFeedState(), keep); again(); };
  opts.mount.querySelectorAll('.achip').forEach((c) => (c.onclick = () => { const k = c.dataset.x; set(k, k === 'raw' ? false : k === 'days' ? '30' : ''); }));
  const mb = opts.mount.querySelector('#fmore');
  if (mb) mb.onclick = () => { opts.state.limit = st.limit + 24; again(); };
}

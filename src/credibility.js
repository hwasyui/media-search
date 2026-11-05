// Tiering kredibilitas sumber berbasis domain — DETERMINISTIK, bukan AI.
// Konsep sama seperti "Domain Authority Tiering" di sistem referensi: Official > Mainstream > Social Forum.
// Dibuat non-AI dengan sengaja: domain resmi regulator/bursa tidak butuh LLM untuk dikenali, dan hasilnya
// harus konsisten 100% tiap kali (bukan tebakan model yang bisa beda-beda antar run).
// Lima tingkat: official (instansi/bursa/pemeringkat/auditor) > mainstream (redaksi media) > corporate (siaran pers & situs komersial)
// > aggregator (agregator, data pasar, kampus: bukan redaksi) > social_forum (media sosial, forum, tulisan buatan pengguna).

const OFFICIAL_HOSTS = [
  /\.go\.id$/,                 // seluruh domain instansi pemerintah (kemenkeu.go.id, ojk.go.id, bi.go.id, dst.)
  /(^|\.)idx\.co\.id$/,        // Bursa Efek Indonesia
  /(^|\.)ksei\.co\.id$/,       // Kustodian Sentral Efek Indonesia
  /(^|\.)kpei\.co\.id$/,
  /(^|\.)ptba\.co\.id$/,
  /\.mil\.id$/,                // TNI (tni.mil.id, ppid.tniad.mil.id)
  /(^|\.)(pefindo\.com|fitchratings\.com|moodys\.com|spglobal\.com|pwc\.com|deloitte\.com|kpmg\.com|ey\.com)$/,      // lembaga pemeringkat & auditor global (situs resmi mereka)
];

const SOCIAL_HOSTS = [
  /(^|\.)(x|twitter)\.com$/,
  /(^|\.)instagram\.com$/,
  /(^|\.)facebook\.com$/,
  /(^|\.)tiktok\.com$/,
  /(^|\.)threads\.net$/,
  /(^|\.)linkedin\.com$/,
  /(^|\.)reddit\.com$/,
  /(^|\.)(youtube\.com|youtu\.be)$/,
  /(^|\.)kaskus\.co\.id$/,
  /(^|\.)stockbit\.com$/,
  /(^|\.)(mediakonsumen\.com|suarapembaca\.detik\.com|kompasiana\.com|quora\.com|medium\.com)$/,       // tulisan buatan pengguna (surat pembaca, keluhan, blog), bukan redaksi
  /(^|\.)telegram\.(org|me)$/,
];

// Siaran pers/situs milik perusahaan atau produk komersial: bukan pihak ketiga yang independen, jadi tidak disamakan dengan berita redaksi.
const CORPORATE_HOSTS = [
  /(^|\.)(bca\.co\.id|bcasekuritas\.co\.id|telkom\.co\.id|telkomsel\.com|grab\.com|pertamina\.com|pupuk-indonesia\.com|perhutani\.co\.id|patraindonesia\.com)$/,
  /(^|\.)(gotocompany\.com|gojek\.com|tokopedia\.com|garuda-indonesia\.com|ptfi\.co\.id|freeport\.com|pln\.co\.id)$/,
  /(^|\.)(gramedia\.com|moladin\.com|pintu\.co\.id|ajaib\.co\.id|pluang\.com|qoo10\.co\.id|heygotrade\.com|maybanktrade\.co\.id|lotussekuritas\.com|bareksa\.com)$/,
];

// Agregator, data pasar, dan situs non-redaksi (kampus, madrasah, aplikasi): mengutip atau menampilkan data pihak lain, bukan liputan sendiri.
const AGGREGATOR_HOSTS = [
  /(^|\.)(tradingview\.com|investing\.com|finance\.yahoo\.com|msn\.com|headtopics\.com|feedberry\.com|moovitapp\.com|hypebeast\.com|t\.co|tradersunion\.com|quantumzeitgeist\.com)$/,
  /\.ac\.id$/,
  /\.mdrsh\.id$/,
];

const TIERS = {
  official: { key: 'official', label: 'Official', score: 95 },
  mainstream: { key: 'mainstream', label: 'Mainstream', score: 80 },
  corporate: { key: 'corporate', label: 'Corporate', score: 60 },
  aggregator: { key: 'aggregator', label: 'Aggregator', score: 50 },
  social_forum: { key: 'social_forum', label: 'Social Forum', score: 38 },
};

export function credibilityOf(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* host tetap '' */ }
  const tier = OFFICIAL_HOSTS.some((re) => re.test(host)) ? TIERS.official
    : SOCIAL_HOSTS.some((re) => re.test(host)) ? TIERS.social_forum
    : CORPORATE_HOSTS.some((re) => re.test(host)) ? TIERS.corporate
    : AGGREGATOR_HOSTS.some((re) => re.test(host)) ? TIERS.aggregator
    : TIERS.mainstream;                                     // default: domain berita/web lain dianggap mainstream
  return { ...tier, host };
}

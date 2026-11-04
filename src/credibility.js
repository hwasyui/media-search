// Tiering kredibilitas sumber berbasis domain — DETERMINISTIK, bukan AI.
// Konsep sama seperti "Domain Authority Tiering" di sistem referensi: Official > Mainstream > Social Forum.
// Dibuat non-AI dengan sengaja: domain resmi regulator/bursa tidak butuh LLM untuk dikenali, dan hasilnya
// harus konsisten 100% tiap kali (bukan tebakan model yang bisa beda-beda antar run).

const OFFICIAL_HOSTS = [
  /\.go\.id$/,                 // seluruh domain instansi pemerintah (kemenkeu.go.id, ojk.go.id, bi.go.id, dst.)
  /(^|\.)idx\.co\.id$/,        // Bursa Efek Indonesia
  /(^|\.)idxchannel\.com$/,
  /(^|\.)ksei\.co\.id$/,       // Kustodian Sentral Efek Indonesia
  /(^|\.)kpei\.co\.id$/,
  /(^|\.)ptba\.co\.id$/,
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
  /(^|\.)telegram\.(org|me)$/,
];

const TIERS = {
  official: { key: 'official', label: 'Official', score: 95 },
  mainstream: { key: 'mainstream', label: 'Mainstream', score: 80 },
  social_forum: { key: 'social_forum', label: 'Social Forum', score: 38 },
};

export function credibilityOf(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* host tetap '' */ }
  const tier = OFFICIAL_HOSTS.some((re) => re.test(host)) ? TIERS.official
    : SOCIAL_HOSTS.some((re) => re.test(host)) ? TIERS.social_forum
    : TIERS.mainstream;                                     // default: domain berita/web lain dianggap mainstream
  return { ...tier, host };
}

// Baris "Status" di briefing — template string interpolation, non-AI, format seragam (anti-halusinasi).
export function statusLine(credibility, category) {
  const prefix = category === 'rumor'
    ? 'Belum terverifikasi secara resmi. '
    : '';
  if (credibility.key === 'official') {
    return `${prefix}Bersumber dari rilis/situs resmi otoritas atau bursa (${credibility.host}).`;
  }
  if (credibility.key === 'social_forum') {
    return `${prefix}Sinyal berasal dari obrolan/sentimen media sosial (${credibility.host}). `
      + 'Merupakan persepsi publik, bukan keterbukaan informasi resmi.';
  }
  return `${prefix}Dilaporkan oleh media massa (${credibility.host}).`;
}

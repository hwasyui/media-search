// Helper format & tautan untuk tampilan (dipindahkan dari helper global portal.html).
export const nf = (n: number | null | undefined, d = 0) => (n == null ? '–' : Number(n).toLocaleString('id-ID', { maximumFractionDigits: d }));

export function ago(iso: string | number | null | undefined): string {
  const d = new Date(iso as string), s = (Date.now() - d.getTime()) / 1000;
  if (isNaN(s)) return '';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} menit lalu`;
  if (s < 86400) return `${Math.round(s / 3600)} jam lalu`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} hari lalu`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const fullDate = (iso: string | null | undefined) => {
  const d = new Date(iso as string);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
};

export const fmtDT = (v: string | null | undefined) =>
  (v ? new Date(v).toLocaleString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');

export const money = (n: number | null | undefined, cur?: string) => {
  if (n == null) return '–';
  const a = Math.abs(n), sg = n < 0 ? '-' : '';
  const u: [number, string] = a >= 1e12 ? [a / 1e12, ' T'] : a >= 1e9 ? [a / 1e9, ' M'] : a >= 1e6 ? [a / 1e6, ' jt'] : [a, ''];
  return `${sg}${nf(u[0], 2)}${u[1]} ${cur || ''}`.trim();
};

export const compact = (n: number | null | undefined) => {
  if (n == null) return '–';
  const a = Math.abs(n), sg = n < 0 ? '-' : '';
  return sg + (a >= 1e12 ? nf(a / 1e12, 1) + 'T' : a >= 1e9 ? nf(a / 1e9, 1) + 'M' : a >= 1e6 ? nf(a / 1e6, 1) + 'jt' : nf(a, 0));
};

// ---- tautan ----
const isBadUrl = (u?: string | null) => !u || /^https?:\/\/(www\.)?google\.com\/search\?/i.test(u) || /^\/go\//i.test(u) || /^https?:\/\/[^/]+\/go\//i.test(u);

export const safeUrl = (u?: string | null) => {
  if (!u || isBadUrl(u) || u === '#' || u.startsWith('/go/')) return '#';
  return /^https?:\/\//i.test(u) ? u : '#';
};

/** Alamat artikel asli penerbit (hanya URL asli penerbit; jangan pernah memakai endpoint lokal /go/:id). */
export const artUrl = (r: { article_url?: string | null; url?: string | null }) => {
  if (r.article_url && !isBadUrl(r.article_url) && !/^https:\/\/news\.google\.com\//i.test(r.article_url)) return r.article_url;
  if (r.url && !isBadUrl(r.url) && !/^https:\/\/news\.google\.com\//i.test(r.url)) return r.url;
  return '#';
};

export const faviconUrl = (domain: string, size = 32) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;

/** Escape teks untuk disisipkan ke HTML mentah (tooltip, balasan asisten). */
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Tanggal + jam lokal Indonesia; '–' bila kosong. */
export const dt = (v: string | number | Date | null | undefined, fallback = '–') => (v ? new Date(v).toLocaleString('id-ID') : fallback);

// Pembersih input analis untuk alias & query tambahan perusahaan (dulu ada di server.js).
// Query tambahan: teks pencarian bebas, tanpa karakter kontrol, maks. 10 query @ 150 karakter.
const squash = (s: unknown, max: number) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export const cleanQueries = (v: unknown) =>
  [...new Set((Array.isArray(v) ? v : []).map((q) => squash(q, 150)).filter((q) => q.length >= 3))].slice(0, 10);

export const cleanAliases = (v: unknown) =>
  [...new Set((Array.isArray(v) ? v : []).map((a) => squash(a, 100)).filter((a) => a.length >= 2))].slice(0, 12);

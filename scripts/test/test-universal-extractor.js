// Uji ekstraktor paragraf universal pada dump HTML lokal (jalankan dari folder yang berisi file .html dump).
import fs from 'node:fs';

const JUNK_START = /^(baca juga|simak juga|baca disini|baca artikel|pilihan editor|advertisement|halaman selanjutnya|editor:|penulis:|kontributor:|pewarta\s*:|copyright\s*&copy;)/i;

for (const [name, label] of [['industry_dump', 'Industry.co.id (#536)'], ['kalimantan_dump', 'Kalimantan Post (#1007)'], ['1942_fajarpapua', 'Fajar Papua (#1942)'], ['5303_pedoman', 'Pedoman Bengkulu (#5303)']]) {
  const html = fs.readFileSync(`${name}.html`, 'utf8');

  // Pre-clean
  let c = html;
  for (const tag of ['script', 'style', 'header', 'footer', 'nav', 'aside']) {
    c = c.replace(new RegExp(`<${tag}\\b[^<]*(?:(?!</${tag}>)<[^<]*)*</${tag}>`, 'gi'), ' ');
  }

  // Normalize:
  c = c.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '</p><p>');
  c = c.replace(/<p\b([^>]*)>/gi, '</p><p$1>');
  c = c.replace(/<div\b[^>]*style=['"][^'"]*text-align:\s*(?:justify|left)[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi, '</p><p>$1</p><p>');

  const paras = [];
  for (const m of c.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const raw = m[1].replace(/<[^>]+>/g, ' ').trim().replace(/\s+/g, ' ');
    if (raw.length >= 35 && !JUNK_START.test(raw)) paras.push(raw);
  }

  console.log(`${label}: ${paras.length} paragraphs, Total chars: ${paras.reduce((a, p) => a + p.length, 0)}`);
  if (paras.length) {
    console.log(`   First: ${paras[0].slice(0, 70)}...`);
    console.log(`   Last:  ${paras[paras.length - 1].slice(0, 70)}...`);
  }
}

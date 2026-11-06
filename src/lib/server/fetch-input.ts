// Validasi masukan pencarian (dipakai /api/fetch dan /api/fetch/stream).
import { SOURCES, MODIFIERS } from '@/news/search.js';

export function parseFetchInput(b: any): { keywords: string[]; sources: string[]; modifiers: string[]; total: number } {
  const { keywords = [], sources = [], modifiers = ['none'] } = b;
  return {
    keywords: [...new Set(keywords.map((k: unknown) => String(k).trim()).filter(Boolean))].slice(0, 6) as string[],
    sources: sources.filter((s: string) => (SOURCES as any)[s] && !(SOURCES as any)[s].disabled),
    modifiers: modifiers.filter((m: string) => (MODIFIERS as any)[m]),
    get total() { return this.keywords.length * this.sources.length * this.modifiers.length; },
  };
}

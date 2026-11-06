import { fail, json } from '@/lib/server/http';
import { cleanCovers, coverStats } from '@/content/covers-clean.js';

// Ukuran cache gambar sampul (data/covers) dan pembersihannya.
export async function GET() {
  try { return json(await coverStats()); } catch (e) { return fail(e); }
}

export async function POST() {
  try { await cleanCovers(); return json(await coverStats()); } catch (e) { return fail(e); }
}

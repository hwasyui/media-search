import { fail, json, query } from '@/lib/server/http';
import { searchIdx } from '@/risk/financial.js';

// Cari emiten langsung dari database Bursa Efek Indonesia (IDX)
export async function GET(req: Request) {
  try {
    return json({ results: await searchIdx(query(req).q || '') });
  } catch (e) { return fail(e); }
}

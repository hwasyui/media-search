import { json } from '@/lib/server/http';
import { listReports } from '@/db/store.js';

export async function GET() {
  return json(await listReports());
}

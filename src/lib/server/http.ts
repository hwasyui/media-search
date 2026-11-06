// Helper kecil untuk route handler: padanan req.query / req.body / res.json / res.status milik Express.
import type { NextRequest } from 'next/server';

export const json = (data: unknown, status = 200) => Response.json(data, { status });
export const fail = (e: unknown, status?: number) => {
  const err = e as { message?: string; status?: number };
  return Response.json({ error: err?.message ?? String(e) }, { status: status ?? err?.status ?? 500 });
};

/** req.query ala Express: objek {kunci: nilai-string}; kunci yang tidak ada tetap `undefined`. */
export const query = (req: NextRequest | Request): Record<string, string | undefined> => Object.fromEntries(new URL(req.url).searchParams);

/** req.body ala express.json(): objek kosong bila body kosong / bukan JSON. */
export async function body(req: Request): Promise<any> {
  try { return (await req.json()) ?? {}; } catch { return {}; }
}

/** Alamat IP klien dari socket, dipasang server.js di header x-client-ip (timpa kiriman klien). Kosong bila tidak lewat server.js. */
export function clientIp(req: Request): string {
  return (req.headers.get('x-client-ip') || '').replace('::ffff:', '');
}

export const isDigits = (s: string) => /^\d+$/.test(s);

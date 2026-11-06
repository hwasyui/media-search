// Gambar artikel secara lazy: diminta hanya untuk berita yang sedang tampil (maks. 12 id per permintaan, ditunda 350 ms supaya digabung),
// lalu kartu menampilkannya. Pengganti MutationObserver + insertLazyImage versi lama.
type Pending = { resolve: (ok: boolean) => void };

const asked = new Map<number, Promise<boolean>>();
const queue = new Map<number, Pending[]>();
let timer: ReturnType<typeof setTimeout> | undefined;

async function flush() {
  timer = undefined;
  const ids = [...queue.keys()].slice(0, 12);
  const waiters = ids.map((id) => [id, queue.get(id)!] as const);
  ids.forEach((id) => queue.delete(id));
  try {
    const r = await fetch('/api/news/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) }).then((x) => x.json());
    for (const [id, list] of waiters) list.forEach((w) => w.resolve(Boolean(r.images?.[id])));
  } catch {
    for (const [, list] of waiters) list.forEach((w) => w.resolve(false));      // tanpa gambar: kartu tetap normal
  }
  if (queue.size) timer = setTimeout(flush, 350);
}

/** Minta gambar untuk satu berita. Selesai dengan true bila gambarnya tersedia di /img/:id. Satu id hanya ditanyakan sekali. */
export function requestImage(id: number): Promise<boolean> {
  const hit = asked.get(id);
  if (hit) return hit;
  const p = new Promise<boolean>((resolve) => {
    queue.set(id, [{ resolve }]);
    if (!timer) timer = setTimeout(flush, 350);
  });
  asked.set(id, p);
  return p;
}

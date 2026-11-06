// Server Media Search = Next.js (UI + API) dibungkus server HTTP tipis.
// Pembungkus ini ada karena dua hal yang tidak bisa dilakukan route handler:
//   1. Mengambil IP klien dari socket (header x-forwarded-for dari klien bisa dipalsukan) untuk pembatasan laju asisten & log LAN.
//   2. Log akses dari perangkat LAIN (bukan laptop ini): IP, request, status, dan browser.
//   node server.js           -> mode development (hot reload)
//   node server.js --prod    -> mode produksi (jalankan `npm run build` dulu)
import { createServer } from 'node:http';
import next from 'next';

const dev = !process.argv.includes('--prod');
const port = Number(process.env.PORT) || 3000;
const app = next({ dev, hostname: '0.0.0.0', port });
const handle = app.getRequestHandler();
await app.prepare();

const LOCAL_IPS = new Set(['127.0.0.1', '::1', '192.168.205.26']);

createServer((req, res) => {
  const ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  req.headers['x-client-ip'] = ip;      // menimpa kiriman klien; hanya ini yang dipercaya (lihat clientIp di src/lib/http.ts)
  if (!LOCAL_IPS.has(ip)) {
    const t = Date.now();
    res.on('finish', () => console.log('[lan] ' + ip + ' ' + req.method + ' ' + String(req.url).slice(0, 80) + ' -> ' + res.statusCode + ' ' + (Date.now() - t) + 'ms | ' + String(req.headers['user-agent'] || '').slice(0, 70)));
  }
  handle(req, res);
}).listen(port, () => console.log(`Media Search (${dev ? 'dev' : 'produksi'}) jalan di http://localhost:${port}`));

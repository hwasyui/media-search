// Unmask URL Google News ke alamat artikel penerbit (teknik decode token batchexecute, padanan googlenewsdecoder).
// Mencoba decode token Google News secara langsung.
// Bila gagal (misal 429 dari batchexecute), mengembalikan success: false.
// Pakai: node unmask-url.js <url>   ->  cetak satu baris JSON {"success": ..., "decoded_url"|"message": ...}
import pkg from 'google-news-url-decoder';
import { pyJson } from '../lib/util.js';

const { GoogleDecoder } = pkg;

async function decodeUrl(url) {
  try {
    const res = await new GoogleDecoder().decode(url);
    if (res && res.status) {
      const decoded = res.decoded_url;
      if (decoded && !decoded.startsWith('https://news.google.com')) return { success: true, decoded_url: decoded };
    }
    return { success: false, message: res && typeof res === 'object' ? (res.message ?? null) : 'decode_failed' };
  } catch (e) {
    return { success: false, message: String(e?.message || e) };
  }
}

if (process.argv[2]) console.log(pyJson(await decodeUrl(process.argv[2])));
else console.log(pyJson({ success: false, message: 'no_url_provided' }));

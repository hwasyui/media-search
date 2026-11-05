// Klien MCP: menjalankan MCP Toolbox (Google) sebagai proses anak lewat stdio dan memanggil alat-alatnya (mcp/tools.yaml).
// Klien MCP: menjalankan MCP Toolbox (Google) sebagai proses anak lewat stdio dan memanggil alat-alatnya (mcp/tools.yaml).
// KEAMANAN
//  * Biner TIDAK dijalankan sebelum SHA-256-nya cocok dengan hash yang sudah diverifikasi (rilis resmi v1.15.0 = hash di halaman rilis GitHub = hash di paket npm,
//    tanda tangan digital Google LLC valid). Bila berbeda (mis. paket diganti), server MCP menolak dijalankan.
//  * stdio saja: tidak membuka port. --disable-version-check mematikan satu-satunya panggilan keluar bawaan (ke api.github.com); telemetri tidak dinyalakan.
//  * Lingkungan proses anak dibatasi: hanya variabel dasar sistem + MCP_DB_*. Kunci AI dan DB_PASSWORD admin tidak diteruskan.
//  * Alat hanya SQL tetap berparameter; hak DB user mcp_ro hanya SELECT (db/mcp_readonly_user.sql).
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TOOLS_FILE = path.join(ROOT, 'mcp', 'tools.yaml');
const TOOLBOX_VERSION = '1.15.0';
// SHA-256 biner Toolbox v1.15.0 yang sudah diverifikasi (jangan diubah tanpa memverifikasi ulang rilis barunya)
const VERIFIED = {
  'win32-x64': '354fdc30bf9afdefdeb512086da9aaf38c1b447ed596d0e4109b5d3bf581ceee',
  'linux-x64': 'f6fac005c39898a379523700727a2a3d0a2828f579bec22cc0efe74e0652062d',
};
const key = `${process.platform}-${process.arch}`;
export const toolboxPath = () => path.join(ROOT, 'node_modules', '@toolbox-sdk', `server-${key}`, 'bin', process.platform === 'win32' ? 'toolbox.exe' : 'toolbox');

let hashOk = null;
async function verifyBinary(file) {
  if (hashOk) return;
  const want = VERIFIED[key];
  if (!want) throw new Error(`MCP: platform ${key} belum punya hash terverifikasi`);
  await access(file).catch(() => { throw new Error(`MCP: biner Toolbox tidak ada (${file}). Jalankan: npm install`); });
  const h = createHash('sha256');
  await new Promise((res, rej) => createReadStream(file).on('data', (c) => h.update(c)).on('end', res).on('error', rej));
  const got = h.digest('hex');
  if (got !== want) throw new Error(`MCP: hash biner Toolbox TIDAK cocok (${got.slice(0, 12)}… != ${want.slice(0, 12)}…). Server MCP tidak dijalankan.`);
  hashOk = true;
}

let client = null, connecting = null, toolList = null;

async function connect() {
  const file = toolboxPath();
  await verifyBinary(file);
  const need = ['MCP_DB_USER', 'MCP_DB_PASSWORD'].filter((k) => !process.env[k]);
  if (need.length) throw new Error(`MCP: ${need.join(', ')} belum diisi di .env (user MySQL read-only, lihat db/mcp_readonly_user.sql)`);
  const env = {
    ...getDefaultEnvironment(),
    MCP_DB_HOST: process.env.MCP_DB_HOST || 'localhost', MCP_DB_PORT: process.env.MCP_DB_PORT || '3306',
    MCP_DB_USER: process.env.MCP_DB_USER, MCP_DB_PASSWORD: process.env.MCP_DB_PASSWORD,
  };
  const transport = new StdioClientTransport({
    command: file, args: ['--config', TOOLS_FILE, '--stdio', '--disable-version-check', '--disable-reload'],
    env, stderr: 'pipe', cwd: ROOT,
  });
  let lastErr = '';
  transport.stderr?.on('data', (d) => { const s = String(d); if (/ERROR|WARN.*(?!wildcard)/.test(s) && !/wildcard/.test(s)) lastErr = s.trim().slice(0, 300); });
  const c = new Client({ name: 'media-search', version: '1.0.0' });
  c.onclose = () => { if (client === c) { client = null; toolList = null; } };
  try { await c.connect(transport, { timeout: 30000 }); }
  catch (e) { try { await c.close(); } catch { /* sudah tertutup */ } throw new Error('MCP: gagal terhubung ke Toolbox' + (lastErr ? ' - ' + lastErr : ': ' + e.message)); }
  client = c;
  return c;
}

/** Klien yang aktif (menyambung bila belum / bila proses anak mati). Satu proses anak dipakai bersama. */
export async function mcpClient() {
  if (client) return client;
  connecting ||= connect().finally(() => { connecting = null; });
  return connecting;
}

/** Daftar alat [{name, description, inputSchema}] (di-cache selama sambungan hidup). */
export async function mcpTools() {
  if (toolList) return toolList;
  const c = await mcpClient();
  const r = await c.listTools();
  toolList = r.tools.map((t) => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema }));
  return toolList;
}

/** Panggil satu alat. Mengembalikan { text, isError }. Alat yang tidak terdaftar ditolak. */
export async function mcpCall(name, args = {}, { signal, timeoutMs = 25000 } = {}) {
  const tools = await mcpTools();
  if (!tools.some((t) => t.name === name)) return { text: `alat "${name}" tidak ada`, isError: true };
  const c = await mcpClient();
  try {
    const r = await c.callTool({ name, arguments: args }, undefined, { signal, timeout: timeoutMs });
    const text = (r.content || []).map((p) => (p.type === 'text' ? p.text : `[${p.type}]`)).join('\n');
    return { text, isError: !!r.isError };
  } catch (e) {
    return { text: `gagal memanggil ${name}: ${e.message}`, isError: true };
  }
}

export async function closeMcp() {
  const c = client; client = null; toolList = null;
  if (c) { try { await c.close(); } catch { /* abaikan */ } }
}
export const mcpInfo = () => ({ version: TOOLBOX_VERSION, connected: !!client, platform: key });
process.on('exit', () => { try { client?.close(); } catch { /* abaikan */ } });

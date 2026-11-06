// Dijalankan sekali saat server Next menyala (pengganti bagian bawah server.js).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node');
}

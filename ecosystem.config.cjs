// Menjalankan Media Search sebagai proses latar belakang dengan pm2 (tetap jalan walau terminal ditutup, restart otomatis bila crash).
//   npm run pm2:start     jalankan
//   npm run pm2:status    lihat status
//   npm run pm2:logs      lihat log
//   npm run pm2:restart   restart (setelah ubah kode)
//   npm run pm2:stop      hentikan
module.exports = {
  apps: [{
    name: 'media-search',
    script: 'server.js',
    cwd: __dirname,
    node_args: '--env-file-if-exists=.env',
    autorestart: true,          // hidup lagi otomatis bila crash
    min_uptime: '10s',          // dianggap crash-loop bila mati < 10 detik setelah start
    max_restarts: 20,
    restart_delay: 3000,
    watch: false,
    time: true,                 // cap waktu di log
    merge_logs: true,
    out_file: 'logs/out.log',
    error_file: 'logs/error.log',
    env: {
      // 1 = setelah server hidup lagi (mis. crash), job Task Runner yang terputus dilanjutkan otomatis dari checkpoint.
      // 0 = tunggu tombol "Lanjutkan" manual.
      AUTO_RESUME: '1',
    },
  }],
};

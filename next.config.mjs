/** @type {import('next').NextConfig} */
const nextConfig = {
  // Paket bawaan Node / berat: jangan di-bundle, biarkan di-require langsung dari node_modules.
  serverExternalPackages: ['mysql2', 'playwright', 'cheerio', '@modelcontextprotocol/sdk', 'google-news-url-decoder', 'fast-xml-parser'],
  async redirects() {
    // Alamat lama (halaman HTML statis) tetap berfungsi; #bagian di belakangnya dipertahankan oleh browser saat redirect.
    return [
      { source: '/portal.html', destination: '/', permanent: false },
      { source: '/jobs.html', destination: '/jobs', permanent: false },
      { source: '/help.html', destination: '/help', permanent: false },
      { source: '/diagnose.html', destination: '/diagnose', permanent: false },
    ];
  },
};
export default nextConfig;

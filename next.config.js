/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
  experimental: {
    // pdfjs-dist + pdf-parse are heavy native-ish modules; let Next bundle
    // them as externals so the serverless function doesn't choke on the
    // worker code or eval-style polyfills they ship.
    serverComponentsExternalPackages: ['pdfjs-dist', 'pdf-parse'],
  },
};

module.exports = nextConfig;

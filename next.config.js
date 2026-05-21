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
    // pdfjs-dist + pdf-parse + mammoth + xlsx are heavy native-ish modules;
    // let Next leave them as externals so the serverless function doesn't
    // choke on the worker code, eval-style polyfills, or large dictionaries
    // they ship.
    serverComponentsExternalPackages: ['pdfjs-dist', 'pdf-parse', 'mammoth', 'xlsx'],
    // Force the pdfjs worker file into the upload function's bundle. Next's
    // file-tracing won't pick it up automatically because it's resolved
    // dynamically at runtime via createRequire(). Without this Vercel's
    // serverless function 404s on the worker and silently falls back to
    // pdf-parse — which loses the positioned-text data we actually need.
    outputFileTracingIncludes: {
      '/api/drafter/upload': [
        './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
        './node_modules/pdfjs-dist/legacy/build/pdf.mjs',
      ],
    },
  },
};

module.exports = nextConfig;

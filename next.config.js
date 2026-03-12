/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force the pdfjs worker file into the serverless bundle for /api/documents/process.
  // pdfjs-dist is kept external (not webpack-bundled) but its worker is referenced via
  // a runtime path string — file tracing won't find it automatically.
  outputFileTracingIncludes: {
    '/api/documents/process': ['./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
    // Exclude native modules from webpack bundling (Next.js 14 syntax)
    serverComponentsExternalPackages: ['@napi-rs/canvas', 'canvas', 'pdfjs-dist'],
  },
  // Exclude mobile app from Next.js type checking
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
  // Also configure webpack to ignore native modules
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        '@napi-rs/canvas': 'commonjs @napi-rs/canvas',
        'canvas': 'commonjs canvas',
      });
    }
    return config;
  },
}

module.exports = nextConfig

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
    // Exclude native modules from webpack bundling (Next.js 14 syntax)
    serverComponentsExternalPackages: ['@napi-rs/canvas', 'canvas', 'pdfjs-dist'],
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

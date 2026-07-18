/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async rewrites() {
    const apiBase = process.env.API_PROXY_TARGET || 'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiBase}/api/:path*`,
      },
      {
        source: '/v1/:path*',
        destination: `${apiBase}/v1/:path*`,
      },
      {
        source: '/docs',
        destination: `${apiBase}/docs`,
      },
      {
        source: '/openapi.json',
        destination: `${apiBase}/openapi.json`,
      },
      {
        source: '/health',
        destination: `${apiBase}/health`,
      },
      {
        source: '/ready',
        destination: `${apiBase}/ready`,
      },
    ];
  },
};

module.exports = nextConfig;

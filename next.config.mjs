/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      { source: '/terms-and-conditions', destination: '/terms' },
      { source: '/terms-and-policy', destination: '/terms' },
      { source: '/privacy-policy', destination: '/terms' },
      { source: '/refund-policy', destination: '/terms' },
      { source: '/contact', destination: '/terms' },
    ];
  },
};

export default nextConfig;

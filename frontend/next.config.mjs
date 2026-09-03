/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@backio/shared'],
  reactStrictMode: true,
  async headers() {
    return [{ source: '/p/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];
  },
};
export default nextConfig;

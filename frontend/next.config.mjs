import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
// La CSP completa (con nonce) la pone el middleware en cada respuesta.
const seguridad = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig = {
  // Raíz del monorepo (pnpm): sin esto Next 15 adivina la raíz y puede tomar un lockfile ajeno al repo.
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
  transpilePackages: ['@backio/shared'],
  reactStrictMode: true,
  // La documentación (public/docs, la copia copiar-docs.mjs) entra por /docs.
  async rewrites() {
    return [{ source: '/docs', destination: '/docs/index.html' }];
  },
  async headers() {
    return [
      { source: '/:path*', headers: seguridad },
      { source: '/p/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
    ];
  },
};
export default nextConfig;

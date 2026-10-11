import type { Metadata } from 'next';
import { connection } from 'next/server';
import './globals.css';

export const metadata: Metadata = {
  title: 'BackIO · Geeks',
  description: 'Sistema operativo de backlog · Geeks Ecuador',
  robots: { index: false, follow: false },
};

/** Render por petición: el nonce de la CSP (middleware) cambia en cada respuesta y Next lo aplica a sus scripts. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

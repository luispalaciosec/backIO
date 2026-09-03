import type { Metadata } from 'next';
import { PortalView } from './_components/PortalView';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Portal cliente. Sin login. Consume /api/portal/:token, que devuelve ClientSafeProject y NADA MÁS. */
export default function PortalPage({ params }: { params: { token: string } }) {
  return (
    <main className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-xl mx-auto">
        <PortalView token={params.token} />
      </div>
    </main>
  );
}

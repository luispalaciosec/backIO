import { redirect } from 'next/navigation';
import { meServer } from '@/lib/me.server';

/** La sección Admin solo existe para el rol admin (el backend también lo exige en /api/v1/admin/*). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await meServer();
  if (me.rol !== 'admin') redirect('/backlog');
  return <>{children}</>;
}

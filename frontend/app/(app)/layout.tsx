import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { Sidebar } from '@/components/Sidebar';
import { meServer } from '@/lib/me.server';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { data } = await supabaseServer().auth.getUser();
  if (!data.user) redirect('/login');
  const me = await meServer();
  return (
    <div className="min-h-screen flex">
      <Sidebar email={data.user.email ?? ''} rol={me.rol} />
      <main className="flex-1 min-w-0 p-6">{children}</main>
    </div>
  );
}

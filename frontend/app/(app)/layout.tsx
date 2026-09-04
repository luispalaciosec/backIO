import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { Sidebar } from '@/components/Sidebar';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { data } = await supabaseServer().auth.getUser();
  if (!data.user) redirect('/login');
  return (
    <div className="min-h-screen flex">
      <Sidebar email={data.user.email ?? ''} />
      <main className="flex-1 min-w-0 p-6">{children}</main>
    </div>
  );
}

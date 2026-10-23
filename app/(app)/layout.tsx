import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import NavClient from './nav-client';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('full_name, role, email').eq('id', user.id).single();
  const isAdmin = profile?.role === 'admin';

  return (
    <div>
      <NavClient name={profile?.full_name || profile?.email || user.email || ''} isAdmin={isAdmin} />
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}

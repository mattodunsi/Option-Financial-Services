'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function NavClient({ name, isAdmin }: { name: string; isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const tabs = [
    { href: '/assess', label: 'Assessment' },
    { href: '/saved', label: 'Saved' },
    ...(isAdmin ? [{ href: '/rules', label: 'Rules' }, { href: '/officers', label: 'Officers' }] : [])
  ];

  return (
    <header className="bg-[var(--primary)] text-white">
      <div className="max-w-5xl mx-auto px-4 flex flex-wrap items-center justify-between gap-2 py-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-white text-[var(--primary)] grid place-items-center font-bold text-sm">O</div>
          <span className="font-semibold text-sm">Option Financial Services</span>
        </div>
        <nav className="flex items-center gap-1 text-sm">
          {tabs.map(t => (
            <Link key={t.href} href={t.href}
              className={`px-3 py-2 rounded-md ${pathname?.startsWith(t.href) ? 'bg-white/15 font-semibold' : 'opacity-85 hover:opacity-100'}`}>
              {t.label}
            </Link>
          ))}
          <span className="opacity-70 text-xs px-2 hidden sm:inline">{name}</span>
          <button onClick={signOut} className="px-3 py-2 rounded-md opacity-85 hover:opacity-100">Sign out</button>
        </nav>
      </div>
    </header>
  );
}

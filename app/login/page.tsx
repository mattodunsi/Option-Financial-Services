'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    router.push('/assess');
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm p-8">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-lg bg-[var(--primary)] text-white grid place-items-center font-bold">O</div>
          <div>
            <div className="font-semibold leading-tight">Option Financial Services</div>
            <div className="text-xs text-[var(--ink-2)]">Loan assessment</div>
          </div>
        </div>
        <div className="mb-4">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" />
        </div>
        <div className="mb-4">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" required value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="text-sm text-[var(--bad)] mb-4">{error}</p>}
        <button type="submit" disabled={loading} className="btn-primary w-full">{loading ? 'Signing in\u2026' : 'Sign in'}</button>
        <p className="text-xs text-[var(--ink-2)] mt-4">Accounts are created by an administrator. Contact your admin if you don\u2019t have one yet.</p>
      </form>
    </div>
  );
}

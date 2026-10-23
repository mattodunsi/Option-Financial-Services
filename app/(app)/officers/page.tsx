'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Profile = { id: string; email: string; full_name: string | null; role: string; created_at: string };

export default function OfficersPage() {
  const [officers, setOfficers] = useState<Profile[]>([]);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState('officer');
  const [msg, setMsg] = useState('');
  const [inviting, setInviting] = useState(false);

  async function load() {
    const supabase = createClient();
    const { data } = await supabase.from('profiles').select('id, email, full_name, role, created_at').order('created_at');
    setOfficers(data || []);
  }
  useEffect(() => { load(); }, []);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true); setMsg('');
    const res = await fetch('/api/admin/invite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, fullName, role })
    });
    const data = await res.json();
    setInviting(false);
    if (!res.ok) { setMsg(data.error || 'Could not send the invite.'); return; }
    setMsg(email + ' has been invited \u2014 they\u2019ll get an email to set a password.');
    setEmail(''); setFullName('');
    load();
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-1">Officers</h1>
      <p className="text-sm text-[var(--ink-2)] mb-4">Admin only. Invited officers receive an email to set their password.</p>

      <form onSubmit={invite} className="card p-5 grid gap-3 sm:grid-cols-3 mb-6">
        <div><label>Email</label><input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div><label>Full name</label><input value={fullName} onChange={e => setFullName(e.target.value)} /></div>
        <div>
          <label>Role</label>
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="officer">Loan officer</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <div className="sm:col-span-3">
          <button type="submit" disabled={inviting} className="btn-primary">{inviting ? 'Sending invite\u2026' : 'Invite officer'}</button>
          {msg && <p className="text-sm mt-2 text-[var(--ink-2)]">{msg}</p>}
        </div>
      </form>

      <div className="grid gap-2">
        {officers.map(o => (
          <div key={o.id} className="card p-3 flex items-center justify-between text-sm">
            <div>
              <div className="font-semibold">{o.full_name || o.email}</div>
              <div className="text-xs text-[var(--ink-2)]">{o.email}</div>
            </div>
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[var(--brand-soft)]">{o.role}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

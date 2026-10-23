import { createClient } from '@/lib/supabase/server';
import Engine from '@/lib/engine';

export default async function SavedPage() {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from('loan_assessments')
    .select('ref, customer_name, customer_phone, product, amount, tenor, decision_status, dti, recommended_amount, created_at')
    .order('created_at', { ascending: false });

  const statusCls: Record<string, string> = {
    approve: 'bg-[var(--ok-soft)] text-[var(--ok)]',
    refer: 'bg-[var(--warn-soft)] text-[var(--warn)]',
    decline: 'bg-[var(--bad-soft)] text-[var(--bad)]'
  };
  const statusLabel: Record<string, string> = { approve: 'Approve', refer: 'Refer', decline: 'Decline' };

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Saved assessments</h1>
      {error && <p className="text-[var(--bad)]">{error.message}</p>}
      {!rows?.length && !error && <p className="text-[var(--ink-2)]">Nothing saved yet.</p>}
      <div className="grid gap-3">
        {rows?.map(r => (
          <div key={r.ref} className="card p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-semibold">{r.customer_name}</div>
              <div className="text-xs text-[var(--ink-2)]">{r.customer_phone} \u00b7 {r.ref} \u00b7 {new Date(r.created_at).toLocaleDateString()}</div>
            </div>
            <div className="text-sm flex gap-4">
              <span>{Engine.money0(r.amount)} / {r.tenor}</span>
              <span>DTI {Engine.pct(r.dti)}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${statusCls[r.decision_status] || ''}`}>{statusLabel[r.decision_status] || r.decision_status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

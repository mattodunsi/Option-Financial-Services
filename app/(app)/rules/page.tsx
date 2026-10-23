'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Engine from '@/lib/engine';

export default function RulesPage() {
  const [rules, setRules] = useState<Record<string, any> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from('business_rules').select('rules').eq('id', 1).single();
      if (data?.rules) setRules(data.rules);
    })();
  }, []);

  function update(key: string, raw: string, type: string) {
    if (!rules) return;
    const value = type === 'number' ? Engine.toNum(raw) : type === 'boolean' ? raw === 'true' : raw;
    const candidate = { ...rules, [key]: value };
    const errs = Engine.validateRules(candidate);
    setErrors(errs);
    if (!errs[key]) setRules(candidate);
  }

  async function save() {
    if (!rules) return;
    const errs = Engine.validateRules(rules);
    if (Object.keys(errs).length) { setErrors(errs); setMsg('Fix the highlighted fields first.'); return; }
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('business_rules').update({ rules, updated_by: user?.id, updated_at: new Date().toISOString() }).eq('id', 1);
    setMsg(error ? 'Could not save: ' + error.message : 'Saved. Changes apply to every officer immediately.');
  }

  if (!rules) return <p className="text-[var(--ink-2)]">Loading\u2026</p>;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-1">Business rules</h1>
      <p className="text-sm text-[var(--ink-2)] mb-4">Admin only. Changes apply to every officer immediately.</p>
      <div className="card p-5 grid gap-4 sm:grid-cols-3">
        {Object.entries(rules).map(([key, value]) => {
          const type = typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'text';
          return (
            <div key={key}>
              <label>{key}</label>
              {type === 'boolean' ? (
                <select defaultValue={String(value)} onChange={e => update(key, e.target.value, type)}>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : (
                <input defaultValue={String(value)} onChange={e => update(key, e.target.value, type)} />
              )}
              {errors[key] && <p className="text-xs text-[var(--bad)] mt-1">{errors[key]}</p>}
            </div>
          );
        })}
      </div>
      <button onClick={save} className="btn-primary mt-4">Save changes</button>
      {msg && <p className="text-sm mt-2 text-[var(--ink-2)]">{msg}</p>}
    </div>
  );
}

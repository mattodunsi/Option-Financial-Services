'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Engine from '@/lib/engine';

type FormState = {
  name: string; dob: string; phone: string; purpose: string; businessName: string; occupation: string;
  income: string; expenses: string; existing: string;
  amount: string; tenor: string; rate: string;
  secGuarantors: string; secCheques: string; secStockValue: string; secTangibleValue: string;
  officer: string; comments: string;
};

const blank: FormState = {
  name: '', dob: '', phone: '', purpose: '', businessName: '', occupation: '',
  income: '', expenses: '', existing: '',
  amount: '', tenor: '', rate: '4.2',
  secGuarantors: '', secCheques: '', secStockValue: '', secTangibleValue: '',
  officer: '', comments: ''
};

export default function AssessPage() {
  const router = useRouter();
  const [rules, setRules] = useState<any>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.from('business_rules').select('rules').eq('id', 1).single();
      if (data?.rules) setRules(data.rules);
    })();
  }, []);

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  const product = useMemo(() => {
    if (!rules) return null;
    const amt = Engine.toNum(form.amount);
    return Engine.classifyProduct(amt, rules);
  }, [form.amount, rules]);

  const { result, validation } = useMemo(() => {
    if (!rules) return { result: null, validation: null };
    const v = Engine.validateForm(form, rules);
    if (v.blocking) return { result: null, validation: v };
    const parsed = Engine.parseForm({
      ...form,
      bankMonths: '', bankCredits: '', bankDebits: '', bankAvgBal: '', bankReturned: '', bankVerified: false
    });
    return { result: Engine.assess(parsed, rules), validation: v };
  }, [form, rules]);

  async function handleSave() {
    if (!result) return;
    setSaving(true); setSaveMsg('');
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const ref = 'OFS-CAM-' + Date.now().toString(36).toUpperCase();
    const { error } = await supabase.from('loan_assessments').insert({
      ref,
      officer_id: user.id,
      customer_name: form.name.trim(),
      customer_phone: form.phone.trim(),
      product: result.product,
      amount: result.inputs.amount,
      tenor: result.inputs.tenor,
      decision_status: result.decision.status,
      dti: result.dti,
      recommended_amount: result.recommended,
      form_data: form,
      rules_snapshot: rules
    });
    setSaving(false);
    setSaveMsg(error ? 'Could not save: ' + error.message : 'Saved as ' + ref);
  }

  if (!rules) return <p className="text-[var(--ink-2)]">Loading business rules\u2026</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_420px] items-start">
      <div className="card p-5 grid gap-4">
        <h1 className="text-xl font-bold">New loan assessment</h1>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer name"><input value={form.name} onChange={set('name')} /></Field>
          <Field label="Date of birth"><input type="date" value={form.dob} onChange={set('dob')} /></Field>
          <Field label="Phone number"><input value={form.phone} onChange={set('phone')} placeholder="08012345678" /></Field>
          <Field label="Loan purpose"><input value={form.purpose} onChange={set('purpose')} /></Field>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Field label="Monthly income"><input value={form.income} onChange={set('income')} inputMode="numeric" /></Field>
          <Field label="Monthly expenses"><input value={form.expenses} onChange={set('expenses')} inputMode="numeric" /></Field>
          <Field label="Existing repayments"><input value={form.existing} onChange={set('existing')} inputMode="numeric" /></Field>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Field label="Requested amount"><input value={form.amount} onChange={set('amount')} inputMode="numeric" /></Field>
          <Field label={product ? `Tenor (${Engine.productTenorLimits(product, rules).unit}s)` : 'Tenor'}>
            <input value={form.tenor} onChange={set('tenor')} inputMode="numeric" />
          </Field>
          {product === 'MLS' && <Field label="Interest rate (% / month)"><input value={form.rate} onChange={set('rate')} inputMode="decimal" /></Field>}
        </section>
        {product && <p className="text-sm text-[var(--ink-2)]">Product: <b>{Engine.PRODUCT_NAMES[product]}</b> ({product})</p>}

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Guarantors provided"><input value={form.secGuarantors} onChange={set('secGuarantors')} inputMode="numeric" /></Field>
          <Field label="Client cheques provided"><input value={form.secCheques} onChange={set('secCheques')} inputMode="numeric" /></Field>
          <Field label="Declared stock value"><input value={form.secStockValue} onChange={set('secStockValue')} inputMode="numeric" /></Field>
          <Field label="Declared tangible collateral"><input value={form.secTangibleValue} onChange={set('secTangibleValue')} inputMode="numeric" /></Field>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Officer name"><input value={form.officer} onChange={set('officer')} /></Field>
          <Field label="Comments"><input value={form.comments} onChange={set('comments')} /></Field>
        </section>
      </div>

      <aside className="card p-5 sticky top-4">
        {!result ? (
          <p className="text-[var(--ink-2)]">Fill in income, amount, tenor{product === 'MLS' ? ' and rate' : ''} to see the assessment.</p>
        ) : (
          <>
            <DecisionBanner result={result} />
            <dl className="grid gap-1.5 text-sm mt-4">
              <Row k="DTI" v={Engine.pct(result.dti)} />
              <Row k="Repayment" v={Engine.money(result.req.loan.periodicRepayment) + ' / ' + result.unit} />
              <Row k="Total repayment" v={Engine.money(result.req.loan.totalRepayment)} />
              <Row k="Recommended amount" v={result.recommended > 0 ? Engine.money0(result.recommended) : 'None'} />
            </dl>
            <button onClick={handleSave} disabled={saving} className="btn-primary w-full mt-4">{saving ? 'Saving\u2026' : 'Save assessment'}</button>
            {saveMsg && <p className="text-sm mt-2 text-[var(--ink-2)]">{saveMsg}</p>}
          </>
        )}
      </aside>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label>{label}</label>{children}</div>;
}
function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between border-t border-[var(--line)] pt-1.5"><dt className="text-[var(--ink-2)]">{k}</dt><dd className="font-semibold">{v}</dd></div>;
}
function DecisionBanner({ result }: { result: any }) {
  const status = result.decision.status;
  const cls = status === 'approve' ? 'bg-[var(--ok-soft)] text-[var(--ok)]' : status === 'refer' ? 'bg-[var(--warn-soft)] text-[var(--warn)]' : 'bg-[var(--bad-soft)] text-[var(--bad)]';
  const label = status === 'approve' ? 'Approve' : status === 'refer' ? 'Refer for review' : 'Decline';
  return (
    <div className={`rounded-xl p-4 ${cls}`}>
      <div className="font-bold text-lg">{label}</div>
      <p className="text-sm mt-1">{result.recommendation}</p>
    </div>
  );
}

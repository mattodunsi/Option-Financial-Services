# Option Financial Services — Loan Assessment

A Next.js app for loan officers to assess customer loan affordability (DLS/WLS/MLS products),
run the DTI/collateral/decision engine, and save assessments — backed by Supabase (database,
auth, row-level security).

## Stack
- Next.js 15 (App Router) + TypeScript + Tailwind
- Supabase: Postgres, Auth (admin-invite only, no public signup), Row Level Security
- Deployed on Render

## Local development
1. Copy `.env.example` to `.env.local` and fill in the three Supabase values (Project Settings → API).
2. `npm install`
3. `npm run dev`

## Roles
- **officer**: create and view their own assessments.
- **admin**: everything an officer can do, plus edit business rules and invite new officers,
  at `/rules` and `/officers`.

The first admin has to be promoted manually once, directly in Supabase:
```sql
update profiles set role = 'admin' where email = 'you@example.com';
```

## Environment variables
| Variable | Where it's used | Safe to expose publicly? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | yes (RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | server only, `/api/admin/invite` | **no — keep secret** |

## What's ported from the original browser app
The loan calculation engine (`lib/engine.ts`) is the same tested logic from the original
single-file app (DLS/WLS/MLS pricing, DTI, collateral tiers, the Approve/Refer/Decline decision
engine) — ported unchanged, not rewritten.

## Not yet ported
The Bank Statement Analyzer (CSV/Excel/PDF/OCR upload, reconciliation, anomaly detection) still
only exists in the original browser-based app. It can be ported into this app as a follow-up.

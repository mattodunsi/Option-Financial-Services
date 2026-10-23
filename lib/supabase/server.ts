import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// For Server Components / Route Handlers: respects the signed-in user via cookies,
// and is subject to the same RLS policies as the browser client.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component where cookies can't be set; middleware refreshes the session instead.
          }
        }
      }
    }
  );
}

// Service-role client: bypasses RLS entirely. Server-only (never imported by client code),
// and only for actions that genuinely need elevated access, like inviting a new officer.
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

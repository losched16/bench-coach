# Rotating BenchCoach's Supabase and Anthropic credentials

A procedure, not an incident record. Incident details — which credential, where
it appeared, whether it was used — are handled privately and do not belong in
this repository.

Never paste a key into a chat, an issue, a PR, a commit, or a log. Every step
below happens in the provider's dashboard and in Vercel's environment settings.

## Where the credentials live

| Consumer | Variable | Scopes |
|---|---|---|
| Vercel project `bench-coach` | `SUPABASE_SERVICE_ROLE_KEY` | Production, Development |
| Vercel project `bench-coach` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production, Development |
| Vercel project `bench-coach` | `ANTHROPIC_API_KEY` | Production, Preview, Development |
| Claude Code cloud environment | `SUPABASE_SERVICE_ROLE_KEY` (if set) | agent sessions |
| Developer machines | `.env.local` | local runs |
| Repository scripts | read from the environment only | `scripts/lib/env-guard.mjs` names the target first |

No GitHub Actions workflow uses a Supabase or Anthropic credential, and no
Edge Function exists. No application code verifies JWTs against the legacy
JWT secret itself.

## Supabase: replace the legacy JWT keys

The legacy `service_role` and `anon` keys are JWTs signed with the project's
legacy JWT secret. Supabase's guidance for a compromised `service_role` key is
to replace it with a secret API key (`sb_secret_…`), move every consumer over,
and then stop accepting the legacy keys. Retiring the legacy JWT secret itself
goes through the JWT signing-keys migration, which is built to avoid signing
users out. Do the steps in order; each one is reversible until step 8.

1. **Supabase → Project Settings → API Keys → Secret keys → Create new secret
   key.** Name it after its consumer (e.g. `vercel-production`).
2. **Vercel → bench-coach → Settings → Environment Variables →
   `SUPABASE_SERVICE_ROLE_KEY`** → set the new `sb_secret_…` value for
   Production (and Development if you use it). Mark it Sensitive.
3. **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** → set it to the project's publishable
   key (`sb_publishable_…`, shown on the same API Keys page — public by design).
4. **Redeploy Production** (Vercel → Deployments → current Production →
   Redeploy). Environment variables are read at build time.
5. **Check the app** while legacy keys still work: sign in, open a team, open
   CoachAI, generate a practice. A 500 or a sign-in loop means a value is wrong
   — revert it and redeploy.
6. **Update every other consumer**: the Claude Code cloud environment variable,
   any `.env.local`.
7. **Supabase → Project Settings → JWT Keys → Migrate JWT secret**, then
   **Rotate keys** to the new asymmetric standby key. Existing sessions keep
   working.
8. **Wait at least one access-token lifetime** (1 hour by default), then move
   the legacy JWT secret to **Revoked**, and **API Keys → Legacy API keys →
   Disable**. From here, anything signed with the legacy secret is refused.

## Anthropic

1. **console.anthropic.com → API Keys → Create key** for BenchCoach production.
2. Vercel → `ANTHROPIC_API_KEY` → new value, Production. Preview does not need
   a live model key; remove that scope unless previews must call the model.
3. Redeploy, check CoachAI answers once.
4. **Delete the old key** in the console. Review its usage in the console's
   usage and logs views for the period it was exposed.

## Verifying

- **Old Supabase key refused.** From an environment that still holds the old
  value, request `…/rest/v1/coaches?select=id&limit=1` with it as both
  `apikey` and `Authorization: Bearer`, and look only at the status: it must be
  401 after step 8. Repeat with the publishable key as `apikey` and the old key
  as `Bearer`: also 401.
- **Old Anthropic key refused**: the console shows it deleted; a request with
  it returns 401.
- **App healthy**: sign in, open a team, CoachAI answers, a practice generates.

Removing a secret from a file or from git history is not remediation. A leaked
credential is dealt with only when it no longer authorizes anything.

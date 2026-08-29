# Committed credential — verification follow-up

29 Aug 2026. **No secret value appears in this document, in any log, or in any
command output produced by this pass.** Nothing was rotated; rotation is the
owner's action.

---

## What was verified

**File:** `scripts/update-playbook-templates.js`, line 20 — the only file in the
repository containing a Supabase JWT.

**Credential type:** a `service_role` key for the production project. The JWT
payload decodes to `role: service_role`, issued 2026-01-22, expiring 2036-01-22.
A `service_role` key **bypasses Row Level Security on every table** and can read,
write and delete anything in the project.

**Is it still active?** **Yes.** Tested with a single read-only request against
production: HTTP 200. It is live.

**Is it the same key currently in use?** **Yes.** SHA-256 of the committed key
matches SHA-256 of `SUPABASE_SERVICE_ROLE_KEY` in this session's environment.
They are one credential.

That last point is the operationally important one: **the key configured in the
Claude Code cloud environment is the already-leaked key.** Rotating it will
break that configuration until it is updated too.

**Git history:** the value appears in 1 commit. It cannot be removed by editing
the file — the history retains it. Rotation is the only remedy.

## Other secrets — scan results

| Pattern | Result |
|---|---|
| Supabase JWT (`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`) | 1 file — `scripts/update-playbook-templates.js` |
| Anthropic keys (`sk-ant-api03-`) | none in the repo |
| Stripe live/test keys (`sk_live_`, `sk_test_`) | none |
| Stripe webhook secret (`whsec_`) | present only in `.next/server/chunks/` — a **build artifact**. `.next` is gitignored and **0 files under it are tracked in git**. Not a repository exposure |
| Postgres connection strings | one match, `migrations/045_seo_editor_role.sql:32` — a documentation placeholder reading `postgresql://benchcoach_seo:<PASSWORD>@<HOST>:5432/postgres`. Not a secret |
| `SUPABASE_SERVICE_ROLE_KEY = "ey…"` assignments | none |

`NEXT_PUBLIC_SUPABASE_ANON_KEY` appears in `lib/authz.ts`, `lib/supabase.ts` and
several routes — read from the environment, and the anon key is designed to be
public. Not a finding.

## What needs rotating

**One credential: the production Supabase `service_role` key.**

Suggested order, so nothing breaks mid-rotation:

1. Supabase → Project Settings → API → roll the `service_role` key
2. Update **Vercel** environment variables → redeploy
3. Update the **Claude Code cloud environment** variable (`SUPABASE_SERVICE_ROLE_KEY`) — it currently holds the leaked value
4. Update any local `.env.local`
5. Confirm the app works — sign in, generate a practice plan, open the drill library
6. Delete the hardcoded literal from `scripts/update-playbook-templates.js` and replace it with `process.env.SUPABASE_SERVICE_ROLE_KEY`

Step 6 is housekeeping, not remediation. The old key is dead after step 1; the
literal is then merely untidy.

## Prior history

`docs/drill-audit.md` (2026-06-29) flagged this same line, naming both
`scripts/enrich-playbooks.js` and `scripts/update-playbook-templates.js`, and
recommended rotation. Two months later the key is unchanged and still live.
`scripts/enrich-playbooks.js` no longer exists.

## Not done

Rotation was not performed — it was not authorised, and it would have taken
production down between steps 1 and 2. No secret was printed, logged, or
committed by this pass.

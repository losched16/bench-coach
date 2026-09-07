# Rotating the exposed Supabase service-role key

**Status: NOT DONE. Operator-only.** Nothing in this session could perform it —
the Supabase connector exposes `execute_sql`, `apply_migration`, `get_advisors`
and `get_publishable_keys`, and no key-management or rotation tool at all.

## What is exposed

A **production `service_role` JWT** for project `chdpqsumqospnaztvfqe`. It
bypasses RLS entirely — it can read and write every coach, player, team, game
and billing row in the database.

| | |
|---|---|
| Entered history | `a2c610d` (8 Aug 2026), the initial import, in `scripts/update-playbook-templates.js` |
| Documented | `2d1d433` — an audit that named it as a finding |
| Removed from the tree | `b80afbb` (5 Sep 2026) |
| Still in history | **yes** |
| Repository visibility | **public** |
| Claims | `role=service_role`, issued 2026-01-22, expires 2036-01-22 |

## Why it is certainly still valid

This was established from the project's key configuration, not by making a
request with the leaked token and not by printing it.

`get_publishable_keys` reports the project's **legacy anon key as
`"disabled": false`**, and that key carries the *same* issued-at and expiry as
the leaked one — both were minted from the project's JWT secret when the project
was created. Legacy JWT keys are therefore still accepted, and a `service_role`
JWT signed with that same secret is accepted along with them.

## Where the key is used

| Consumer | Variable | Notes |
|---|---|---|
| Vercel Production | `SUPABASE_SERVICE_ROLE_KEY` | every server route that reads across users |
| Vercel Preview | — | scope removed; previews have no database (see `docs/deployments.md`) |
| Local `.env.local` | `SUPABASE_SERVICE_ROLE_KEY` | developer machines |
| Repo scripts | read from env only | `b80afbb` removed the last hardcoded copy |

No CI secret uses it — no GitHub Actions workflow in this repo touches Supabase.

## The rotation, in the order that avoids downtime

The project already has a modern publishable key
(`sb_publishable_Ib2e6Tk8FZAcr0BzKuvCgQ_gaJQZClP` — public by design; it ships
in the browser bundle on every page). What it lacks is a modern secret key.
Create one, cut over, *then* disable the legacy keys — that last step is what
kills the leaked credential.

1. **Supabase → Project Settings → API Keys → Secret keys → Create new secret
   key.** Copy the `sb_secret_...` value. Do not paste it into chat, a file, or
   a commit.

2. **Vercel → bench-coach → Settings → Environment Variables.** Edit
   `SUPABASE_SERVICE_ROLE_KEY`, **Production scope only**, to the new
   `sb_secret_...` value. Leave Preview unscoped.

3. **Vercel → Deployments → the current Production deployment → Redeploy.**
   Environment variables are baked in at build time, so an existing deployment
   keeps the old key until it is rebuilt. This step is not optional.

4. **Check the app while legacy keys are still enabled.** Sign in, open the
   dashboard, open a team — confirm pages that read across users still load. If
   they return 500, the new key is wrong: revert step 2 and redeploy.

5. **Move the public key too.** Same screen: set
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Production) to
   `sb_publishable_Ib2e6Tk8FZAcr0BzKuvCgQ_gaJQZClP`, and redeploy. This has to
   happen *before* step 6, because disabling legacy keys invalidates the current
   anon key as well, and every signed-in browser session using it.

6. **Supabase → Project Settings → API Keys → Legacy API keys → Disable.**
   This is the step that invalidates the leaked `service_role` JWT. Everything
   signed with the old JWT secret stops working at this moment.

7. **Update `.env.local`** on any machine that has one.

## Verifying the old key is dead

The check that matters is that the *leaked* key is refused, so it has to be
performed with that value in hand — which is why it belongs to the operator and
not to an agent session.

On a machine that has the old value, send an authenticated read to
`https://chdpqsumqospnaztvfqe.supabase.co/rest/v1/coaches?select=id&limit=1`
using the old key as both the `apikey` and `Authorization: Bearer` header, and
look only at the HTTP status:

- Before rotation: **200**.
- After step 6: **401**. Anything else means legacy keys are still enabled and
  step 6 did not take effect.

Then confirm the app is healthy: sign in, load `/dashboard`, open a team, and
generate one practice plan.

## After rotation

The key stays in git history. That is acceptable **once it is invalid** — a dead
credential in history is a record, not an exposure. Rewriting history to remove
it is a separate decision with its own costs (every clone and every open branch
is invalidated) and should not be bundled with the rotation.

Rotation matters. History rewriting is optional.

## One more, unrelated to Supabase

An Anthropic API key was pasted into a chat transcript earlier in this project's
history. It should be rotated at console.anthropic.com → API Keys, whether or
not it is still in use.

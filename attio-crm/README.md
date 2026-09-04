# BenchCoach League Sales CRM — Attio schema as code

Configures the **Bench Coach** Attio workspace for selling BenchCoach league-wide
to youth baseball leagues, using the standard Companies / People / Deals objects.

**Status: audited, not applied.** The schema is fully defined and the apply
script is written, but nothing has been written to Attio. See
[Why nothing was applied](#why-nothing-was-applied).

---

## Safety model

- **Dry run by default.** `apply.mjs` prints what it would do and exits. It
  writes only with `--commit`.
- **Additive only.** It creates attributes, select options and statuses. It
  never deletes an attribute, never edits one that already exists, and never
  touches record data.
- **Idempotent.** Every create is preceded by a read. Re-running is a no-op.
- **Preflight-gated.** Before any write it checks the token's scopes and
  verifies each endpoint shape with a real GET. If anything is off, it stops
  before the first POST.
- **Archiving is opt-in.** Retiring the four default Deal stages requires
  `--archive-default-stages` *and* a check that zero Deal records exist.

---

## Why nothing was applied

Three independent blockers, all environmental:

1. **The Attio MCP server has no schema-write tools.** It exposes objects,
   attributes, records, lists, notes, tasks, comments and search — all reads
   plus *record-data* writes. There is no `create-attribute`,
   `create-select-option` or `create-status`. Schema configuration is simply
   not in its surface.
2. **`api.attio.com` is unreachable** from the build container:
   `CONNECT tunnel failed, response 403`. So is `docs.attio.com`.
3. **No `ATTIO_API_KEY`** is present in the environment.

The audit was done entirely through the MCP server's read tools, which worked.
See `snapshot/workspace-audit.md`.

### One caveat you should know about

Because `docs.attio.com` is also blocked, **the REST endpoint shapes in
`attio.mjs` come from training knowledge, not from the live API reference.**
They are the documented v2 shapes as I know them, but I could not verify them
today.

This is handled rather than hidden: `apply.mjs` runs a preflight that GETs
every collection it intends to POST to. A wrong path or response shape fails
there, before any write, with the actual response printed. Run
`node apply.mjs` (dry run) first and read that output.

---

## Setup

```bash
cp .env.example .env          # then paste your token into .env
npm install                   # no dependencies; this just creates node_modules
node audit.mjs                # read live schema, print the diff
node apply.mjs                # DRY RUN — shows every intended change
node apply.mjs --commit       # actually create
node verify.mjs               # confirm final state
```

### Getting a token with the right scopes

The API key needs **`object_configuration:read-write`**. A key with only
`record_permission:read-write` can create records but *not* attributes, and
will fail the preflight with a clear message.

1. Attio → **Workspace settings → Developers → API keys → Create key**
2. Name it something like `benchcoach-schema`
3. Grant these scopes:
   - `object_configuration:read-write` — **required**, creates attributes/options/statuses
   - `record_permission:read` — required by the preflight to count Deal records
   - `user_management:read` — optional, resolves the Deal owner ID
4. Copy the key into `.env` as `ATTIO_API_KEY`

The key is workspace-scoped and inherits admin rights. **Never commit `.env`** —
it is gitignored, and `apply.mjs` prints only the last four characters of the
token.

---

## Files

| File | Purpose |
|---|---|
| `schema.mjs` | The desired schema, declaratively. The source of truth. |
| `attio.mjs` | REST client, scope check, endpoint preflight. |
| `audit.mjs` | Reads live schema, prints the diff. Read-only. |
| `apply.mjs` | Creates what is missing. Dry run unless `--commit`. |
| `verify.mjs` | Re-reads and confirms every desired item exists. |
| `snapshot/workspace-audit.md` | The audit performed on 2026-09-04. |
| `docs/VIEWS.md` | Manual click-by-click for the three views. |

---

## What this deliberately does not do

- **No custom League object.** Companies *are* the leagues.
- **No City/State select attributes.** `primary_location` already holds
  structured locality/region. Duplicating it into brittle selects would create
  two sources of truth that drift. See `docs/VIEWS.md` for the export caveat.
- **No Company Outreach Status.** Deal Stage is the pipeline. A second status
  on Companies would go stale the first time someone moved a Deal.
- **No duplicate Public League Email.** `email_addresses` on People is
  multi-value and unique-indexed; a league's generic inbox is a Person record
  (or a Company `description` note) rather than a parallel field.
- **No seeded records.** Nothing fabricates a league, a contact or a deal.

## Schema quality rules encoded here

- **`Unknown` is always distinct from `No`.** Every yes/no attribute is a
  three-option select, never a checkbox. An unresearched league must never look
  like a league that was researched and said no.
- **No checkboxes anywhere**, for the same reason.
- Structured attributes exist only where the value drives qualification,
  segmentation, automation, personalization, execution or reporting. Free-form
  colour goes in notes.

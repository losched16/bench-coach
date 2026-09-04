# Attio workspace audit — 2026-09-04

Read through the Attio MCP server's read tools. **No writes of any kind.**

Workspace: **Bench Coach**
Authenticated as: Clint Losch `<clint@montessoricompass.com>`, admin
`workspace_member_id: 670094e1-bd43-4a51-817c-269849373072`

---

## Objects

Three, all standard. **No custom object exists** — nothing to remove, and no
League object to avoid creating.

| object_id | slug | singular | standard |
|---|---|---|---|
| `e22de5f8-9adb-45b3-afbc-7dfa9571ad45` | `companies` | Company | yes |
| `1be8f85c-beb2-48b0-a393-69348f9cdee2` | `people` | Person | yes |
| `d54091bd-ead9-456c-bc0f-b34618c56f94` | `deals` | Deal | yes |

**Lists: none.**

---

## Records — everything present is Attio demo seed data

| object | records | assessment |
|---|---|---|
| companies | 10 | **All demo.** Airbnb, LVMH, Google, Disney, Intercom, United Airlines, PayPal, Apple, Attio, Microsoft. Every one has `created_by: {actor_type: "system"}` and a `created_at` within nine seconds of workspace creation. |
| deals | **0** | — |
| people | not enumerated | presumed demo contacts attached to the demo companies |

**No real customer or prospect data exists in this workspace.** Nothing is at
risk. Per the brief the demo records are left in place; they do not block the
schema build (they occupy no attribute slugs and no Deal stages).

---

## Companies — 32 attributes, all Attio standard, zero custom

Reused by this schema:

| slug | type | role |
|---|---|---|
| `name` | text | League name |
| `domains` | domain, **unique** | Website + dedupe key |
| `primary_location` | location | structured locality / region / country |
| `description` | text | freeform notes |
| `associated_deals` | record-reference → deals | link to the opportunity |

Present and not used by this schema: `team`, `categories` (select, 20 default
industry options), `logo_url`, `angellist`, `facebook`, `instagram`, `linkedin`,
`twitter`, `twitter_follower_count`, `estimated_arr_usd`, `funding_raised_usd`,
`foundation_date`, `employee_range`, the nine `*_interaction` fields,
`strongest_connection_*`, `record_id`, `created_at`, `created_by`.

`estimated_arr_usd` and `employee_range` are B2B-SaaS-shaped and do not fit a
youth league; they are left alone rather than repurposed, because a field whose
label says one thing and whose contents mean another is worse than an empty one.

---

## People — 29 attributes, all standard, zero custom

Reused:

| slug | type | role |
|---|---|---|
| `name` | personal-name | contact name |
| `job_title` | text | **League Role** — their literal title |
| `email_addresses` | email-address, multi, **unique** | email |
| `linkedin` | text | LinkedIn |
| `company` | record-reference → companies | their league |
| `primary_location` | location | contact location |

`email_addresses` being multi-value and unique-indexed is the concrete reason no
separate "Public League Email" attribute is needed.

---

## Deals — 9 attributes, all standard, **zero custom**

| slug | type | required | note |
|---|---|---|---|
| `name` | text | **yes** | |
| `stage` | **status** | **yes** | see below |
| `owner` | actor-reference | **yes** | must be a workspace member |
| `value` | currency USD | no | |
| `associated_company` | record-reference → companies | no | **the League link** |
| `associated_people` | record-reference → people, multi | no | **the contact link** |
| `record_id`, `created_at`, `created_by` | — | — | system |

### Deal stage — safe to reconfigure

Current statuses are the **untouched Attio default template**:

| order | title | id |
|---|---|---|
| 1 | Lead | `83005410-e95d-4949-a97d-b1389f9ebcd5` |
| 2 | In Progress | `9dba0c7a-f5e3-4a1f-aac2-629b43d3b392` |
| 3 | Won 🎉 | `e2d1c73d-9bd6-4944-b5fa-2c75d4520ab7` |
| 4 | Lost | `ea3ef587-b53a-45c3-9646-f54aaa8be957` |

**Verdict: no conflict.** There is no second pipeline in this workspace — zero
Deal records, zero custom Deal attributes, and the four default stages have
never been edited. Deals are not in use for another business. Reconfiguring the
stage list damages nothing.

`apply.mjs` still adds the twelve new stages first and archives the four
defaults only behind an explicit flag plus a live zero-record check, because
"the audit said it was empty an hour ago" is not the same as "it is empty now".

---

## Diff summary

| | reuse | create | 
|---|---|---|
| Companies | 5 | **18 attributes** (7 select, 1 status, 8 text, 2 number, 1 date) |
| People | 6 | **7 attributes** (4 select, 1 rating, 2 text) |
| Deals | 6 | **11 attributes** (2 number, 6 text, 3 date) |
| Deal stages | — | **12 statuses**, 4 defaults to archive |

**36 attributes, 12 statuses, 0 deletions.**

---

## What blocked the write

1. **The Attio MCP server has no schema-configuration tools.** Its surface is
   objects/attributes/records/lists/notes/tasks/comments/search — reads plus
   *record-data* writes. There is no `create-attribute`, `create-select-option`
   or `create-status`.
2. **`api.attio.com` returns `CONNECT tunnel failed, response 403`** from this
   container. So does `docs.attio.com`.
3. **No `ATTIO_API_KEY`** in the environment.

The audit above was produced entirely through the MCP read tools, which work.

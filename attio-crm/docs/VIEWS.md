# The three views — manual setup

## Can views be created through the API?

**No — and the distinction matters.**

Attio's public REST API covers objects, attributes, records, **lists**, list
entries, notes, tasks, comments, threads, webhooks and workspace members. It has
no endpoint for creating or configuring a **saved view** on an object.

Two different things get called "view" in Attio and only one is API-addressable:

| | API-creatable? | What it is |
|---|---|---|
| **List** | **Yes** (`POST /v2/lists`) | A separate collection of entries with its own attributes. A record can be *added to* a list. |
| **View** | **No** | A saved table/kanban/board configuration *on an object*, with its own columns, filters, sort and grouping. |

All three views requested here are object views — a Companies table and a Deals
kanban — so all three are manual. This was checked against the tool surface
available to this session, which exposes `create-list` and `update-list` but no
view equivalent.

Do not try to fake a view with a List. A List is a real second data structure
with its own membership; using one as a saved filter means somebody has to
maintain membership by hand, and it will drift from the filter it was pretending
to be.

**One place a List genuinely fits:** if the 20-league research pilot should be a
fixed, ordered, hand-curated cohort — "these exact 20, in this order, with a
per-league pilot note" — that is a List, and it can be created via API. That is
a different thing from the Research Queue view below, which should stay a live
filter over all Companies.

---

## 1. League Research Queue

A Companies table showing what needs research and what is done.

1. **Companies** → **+** next to the view tabs → **New view** → **Table**
2. Name it `League Research Queue`
3. **Columns** (gear icon → Edit columns) — in this order:
   - Name
   - Primary location
   - League Type
   - Research Status
   - BenchCoach Fit
   - Decision Maker Identified
   - Estimated Coaches
4. **Sort**: Research Status ascending — puts `Not Started` at the top, which is
   the whole point of a queue
5. **Group by**: Research Status (optional; gives a kanban of the research
   pipeline if Research Status was created as a `status` attribute)
6. Save

**On location:** `primary_location` renders as a single column, and Attio cannot
currently group or filter by its `region` subfield alone. If per-state
segmentation becomes a real workflow need rather than a nice-to-have, the fix is
a single `state` text attribute populated *from* `primary_location` by an
automation — not a hand-maintained select. Deferred deliberately; adding it now
would create a second source of truth before anyone has needed it once.

---

## 2. Tier A Leagues

The shortlist worth working.

1. **Companies** → **New view** → **Table**
2. Name it `Tier A Leagues`
3. **Filter**: `BenchCoach Fit` **is** `A`
4. **Sort**: `Estimated Coaches` **descending**
5. **Columns**: Name, Primary location, Estimated Coaches, Estimated Teams,
   Governing Body, Decision Maker Identified, Personalization Angle
6. Save

Leagues with no `Estimated Coaches` sort to the bottom in Attio, which is the
behaviour you want — an unsized league is not a big league, it is an unfinished
research record.

---

## 3. League Sales Pipeline

1. **Deals** → **New view** → **Kanban**
2. Name it `League Sales Pipeline`
3. **Group by**: `Deal stage`
4. **Hide** these columns from the board so it shows work in flight rather than
   history: `Identified`, `Researched`, `Lost / Not Now`
   - visible: Outreach Ready, Outreach Active, Positive Reply, Meeting
     Scheduled, Discovery Complete, Pilot Proposed, Pilot Active, League Rollout
     Proposed, Won
5. **Card fields**: Associated company, Estimated Pilot Coaches, Next Step,
   Next Step Date
6. Save

`Identified` and `Researched` are hidden rather than removed: a league becomes a
Deal at Identified and the record needs somewhere to live before it is
outreach-ready. They stay in the stage list and out of the board.

---

## Deal owner

Every Deal requires an owner. The only workspace member today is:

```
Clint Losch   clint@montessoricompass.com   admin
workspace_member_id: 670094e1-bd43-4a51-817c-269849373072
```

Automation creating Deals should send:

```json
{ "owner": "670094e1-bd43-4a51-817c-269849373072" }
```

Attio also accepts the member's email address for an `actor-reference`, which is
more readable but breaks if the address changes. **Prefer the UUID**, and read it
at runtime from `GET /v2/workspace_members` rather than hard-coding it, so adding
a second rep does not mean editing code.

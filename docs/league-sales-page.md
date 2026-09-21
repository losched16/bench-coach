# BenchCoach for Leagues — what shipped, and what did not

The sales page at `/leagues`, from the draft dated 2026-09-21.

---

## Claims the draft asked to have verified

It said plainly: *"verify AI access to team/player context, saved notes, shared
plans, assistant permissions, supported age groups, and current plan
customization behavior."* Each was checked against the running product before
the copy was written.

| Claim | Finding |
|---|---|
| AI access to team/player context | **Real.** `app/api/chat/route.ts` loads 24 tables into context, among them `team_notes`, `player_journal_entries`, `player_game_stats`, `player_season_batting`, `practice_plans`, `saved_drills`. |
| Saved notes inform planning | **Real.** The practice planner loads `team_notes` and writes per-player callouts into the generation prompt as `Player notes: …`. |
| Assistant permissions | **Real, with a nuance the copy respects.** Notes are `record`, so an assistant can write them. *Building* a plan is `decide`, so an assistant reads and runs plans rather than creating them. The card says "add team and player notes and work from the same plans" rather than implying they build. |
| Supported age groups | `lib/ageGroups.ts` runs `6U…13U+`. The page says 6U–12U, which **understates** the product and matches the rest of the marketing. |
| Plan customization | **Real** — "Swap Drill" and "Use this plan" are actual controls. |

## Boundaries held

The draft drew these and they are held exactly:

- **"Context" means information supplied to the assistant.** Never "AI watches
  your players", never automatic diagnosis, continuous learning, or
  independent assessment of progress.
- **The development cycle on the page is coach-led throughout.** Choose a
  focus → put it into practice → observe and record → build from there. Every
  verb belongs to the coach. No automated progress tracking, no automatic plan
  advancement, no league-wide player monitoring.
- **No measured improvement**, no guaranteed results, no wins, no fewer parent
  complaints, no registration or retention effects.
- The parent sentence is **proposed messaging a league can use**, marked up as
  a quotation and attributed to nobody. It is not a testimonial.

## Deliberately absent

| | Why |
|---|---|
| **A price** | `lib/tiers.ts` knows `free`, `personal`, `team`. There is no league tier, so terms are a conversation and any figure would be manufactured. The draft invents none and neither does the page. |
| **Scouting** | The draft says it belongs to a travel-program pitch rather than the rec-league one. |
| **Playbooks, Player Reports, Development Plans** | The draft asks that newer features be added only once their behaviour and league availability are confirmed, each as a separate card, and warns specifically against conflating Playbooks with individual development plans. They are verified — see `docs/program-choice.md` — but adding them is a second pass, not this one. |
| **Testimonials, logos, affiliation badges** | None exist. |

## One commitment the page now makes

The dominant call to action is **"Request a League Demo"**, which the draft
asks be confirmed deliverable before the form goes live: *"Confirm that sales
can deliver the offered demo and follow up on inquiries before the form goes
live."*

That is an operational promise, not a code one. A league that fills this in
expects a person to show them the product. If that is not something you want
to commit to, the label should go back to "Ask About League Access" — a
one-word change in `app/leagues/page.tsx`.

## Where a submission goes

`POST /api/league-inquiry`, public and unauthenticated by design, exempted in
`verify-authz` with its reason.

1. **A structured line in the server log** — always, first, unconditionally.
   Recoverable from the Vercel runtime logs. This is what makes the form
   honest: a submission cannot be lost because a third party was down.
2. **A GoHighLevel contact** tagged `league-inquiry` and `league-demo-request`,
   through the same `upsertContact()` the Stripe webhook uses.
3. **A note on that contact** carrying league, role, team count, age groups,
   phone and what they want to improve.

Steps 2 and 3 can never fail the request. `upsertContact` swallows its own
failures and returns null, so a CRM miss is logged loudly rather than passing
unnoticed.

**Still unverified: the GoHighLevel write path against the live CRM.** There
are no GHL credentials in the build environment and writing test contacts into
a production CRM to find out was not worth it. Submit one real inquiry and
confirm the contact appears with both tags and the note attached.

---

# Parent communication — NOT sales-page copy

The draft is explicit that this is collateral for **after** a league has
adopted BenchCoach and confirmed its rollout. It is not on the page, and it is
not an announcement of an existing partnership. Kept here so it is not lost.

## Preseason email or registration announcement

**Subject: A new investment in our coaches—and your player's development**

> This season, our league is providing BenchCoach to our coaching staff to
> support practice planning and player development.
>
> BenchCoach gives coaches access to practice-planning tools, drill
> instructions, coaching guidance, and a place to organize team and player
> notes. These resources can help them prepare activities around the skills
> their teams need to work on and build on what they observe throughout the
> season.
>
> Our coaches will continue to lead their teams and make coaching decisions.
> We're giving them additional resources to draw on as they do that work.
>
> This investment reflects a priority we want families to see on the field:
> purposeful practices, support for our volunteers, and attention to each
> player's opportunity to learn.
>
> We're looking forward to putting these resources to work this season.

## Short registration-page version

> **Investing in the people who coach your child.**
>
> Our league provides BenchCoach to support our coaching staff with practice
> planning, drill guidance, and tools for organizing player-development
> observations. It's one way we're helping our volunteers prepare purposeful
> practices throughout the season.

---

## Offer terms still to settle

The draft invents none of these and neither does the page. They are needed
before a board conversation can close:

licensing unit · head and assistant coach entitlements · price · billing
period · minimums · onboarding responsibilities · support · renewals · what
happens when a coach leaves mid-season.

If pricing is finalised, the FAQ answer "Request league pricing…" and the
Investment section should be replaced with the actual terms. A published
starting price helps boards qualify themselves — but no figure should be
invented to get there.

## Measurement

Nothing has been tested and no lift is claimed. Worth tracking by source:
league-page visits, form starts, submitted inquiries, demos held, proposals,
purchases. After adoption, coach participation and use of planning resources,
with appropriate permissions.

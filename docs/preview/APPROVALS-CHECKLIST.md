# Remaining approval decisions: one checklist

Nothing below has been done. Every box is a decision or action that is yours.

## A. Spending and provisioning

- [ ] **Supabase cost.** I cannot show you an actual figure: the Supabase tool I have has no price-quote
      call, only `create_project`, which would create the project if it were quoted at $0, so I did not
      call it. Get the real number from the dashboard's New project screen (it shows the estimated
      monthly cost before you confirm) and tell me whether it is acceptable. What I can say: your
      AiMS organization is on **Pro**, it already has **7 projects** (6 active), and a new project's
      compute is billed hourly on top. From public pricing as I remember it, the smallest size is about
      $10 a month (about $2 for a week); treat that as unverified.
- [ ] **Resource configuration to confirm** (nothing created yet):
      name `bench-coach-preview` · organization AiMS · region **US East (N. Virginia)** `us-east-1` ·
      smallest compute · default disk · no add-ons (no point-in-time recovery, no read replica, no
      dedicated IPv4) · Postgres 17 · synthetic data only.
- [ ] **Who creates it:** you in the dashboard (recommended, you see the price), or me through the tool
      after you confirm the price in writing.
- [ ] **Vercel:** approve preview-scoped, branch-specific variables and protected previews for
      `claude/academy-phase1` and `claude/agility-pathway`. Production untouched.
- [ ] **Stripe:** you create the test-mode product ($29.00 USD, test only), price and webhook; secrets go
      only into Vercel.

## B. Merges (nothing merged without your word)

- [ ] **PR #34 pitch counter:** recommended; say "merge #34" to authorize.
- [ ] **PR #32 Academy** and **PR #33 speed program:** stay drafts. Not for merge until their blockers
      below are cleared.

## C. Academy decisions

- [ ] Confirm the **$29 USD** one-time price.
- [ ] Refund policy **wording** (behavior is set: full refund revokes, partial keeps access).
- [ ] Terms of sale and Privacy policy, tax position, receipts/invoices, promotion codes.
- [ ] **Chargebacks:** approve `CHARGEBACK-PROPOSAL.md` (flag, keep access while investigating, revoke if
      lost) to be built before launch, or launch with a written manual process.
- [ ] Instructor sign-off on the 19 lessons (`LESSON-VIDEO-APPROVAL.md`). Module 6 stays as written
      (decided). The 6.4 addition and the 3.3 / 5.3 video briefs stay **drafts**.
- [ ] Videos: launch with none, or review and approve some. **0 of 19 are approved.**
- [ ] A real Stripe **test-mode** run in the isolated preview (`STRIPE-TEST-CHECKLIST.md`).
- [ ] Later, deliberately: set price and published status, then `ACADEMY_LAUNCH=1` last.

## D. Speed program decisions

- [ ] A coach signs `COACH-SIGN-OFF.md`: Foundation and Advanced (drafts), the two drill drafts, the
      indoor falling-start substitute (2 yards, 10 ft clear are my numbers).
- [ ] Each video reference reviewed or removed (none is marked reviewed).
- [ ] Phone walkthrough on the synthetic preview (`MOBILE-WALKTHROUGH.md`).
- [ ] Apply migration 081 to production only after the above; then `SPEED_PROGRAM=1`.
- [ ] `player_metrics` bridge: **deferred** (decided).

# Academy: the exact decisions I need from you

**Nothing here is final, and none of it is legal or tax advice.** I am not a lawyer or a tax adviser. Each
decision lists the realistic options, what the code already does, and a blank for your answer. Have a lawyer
read the Terms, Privacy and refund text before any real sale. Tick one box per decision, sign at the end.

## 1. Price
Planning price: **$29.00 USD one-time** (approved for isolated preview testing only; proposed as the launch price).
- ☐ Launch at $29.00 USD  ☐ Launch at another price: ________  ☐ Not decided
Built: the price is set by hand with one SQL statement (`PRICING-PROPOSAL.md`); changing it mid-sale is now safe.

## 2. Refund policy (what the code does is fixed: full refund ends access, partial keeps it)
You decide the **promise**:
- ☐ A. No refunds after purchase (state it plainly; check your consumer-law obligations)
- ☐ B. Refund within ___ days of purchase, no questions asked (common choices: 7, 14, 30)
- ☐ C. Refund within ___ days if the buyer has finished fewer than ___ lessons
- ☐ D. Other: ____________________
Also decide: ☐ refunds are issued by me in the Stripe dashboard on request  ☐ the buyer asks at (email) ____________
Whatever you choose is linked from the sales page and the checkout.

## 3. Sales tax / VAT
- ☐ A. Stripe Tax, price **excludes** tax (tax added at checkout)
- ☐ B. Stripe Tax, price **includes** tax ($29 is what everyone pays)
- ☐ C. Do not collect tax (only if a tax adviser says that is correct for you)
- ☐ D. Other: ____________________
Where you are registered / selling: ____________________
Built: nothing yet. Checkout collects no tax until you pick A or B and I switch it on (a small change, tested in the preview).

## 4. Chargebacks
Built, pending your review (`CHARGEBACK-PROPOSAL.md`): a dispute is recorded, access **stays on** while you
investigate, ends only if the dispute is **lost**, and is **restored** if it is resolved in your favor.
- ☐ Approve as built  ☐ Suspend access as soon as a dispute opens instead  ☐ Do not use; I will handle disputes by hand
- Who is told when one opens: ____________________  (today it appears on the admin page; no email is sent)
- ☐ Block repeat disputers from buying again (not built)

## 5. Terms of sale (one page is usually enough for a digital course)
Confirm each point you want it to say:
- ☐ What the buyer gets: lifetime access to the written course as it exists, plus updates at your discretion
- ☐ Personal, non-transferable licence; no copying, sharing or reselling
- ☐ The course is education, not coaching or medical advice; supervise children; stop for pain (use the course safety notice)
- ☐ No guarantee of results (the sales page already avoids outcome promises)
- ☐ Third-party videos: links only, third-party sites, and you do not control them
- ☐ Refund policy (from #2) and how to ask
- ☐ Which law and where disputes are handled: ____________________
- ☐ Contact for support: ____________________

## 6. Privacy policy (it must cover purchasers)
What the Academy actually collects, so the text can be accurate:
- Account: name and email (BenchCoach login); password handled by Supabase.
- Purchase: Stripe holds card details (the Academy never sees them); the Academy keeps a purchase record (payment id, amount, currency, date).
- Use: which lessons were opened or completed, and when; page-view style events with the course and lesson, signed-in user id only when signed in. **No IP address or device is stored.**
- Not collected: any child's data. (The Academy is for adults who coach children.)
Confirm: ☐ the policy names Stripe, Supabase and Vercel as processors  ☐ a way to ask for deletion: ____________  ☐ analytics wording approved

## 7. Launching without videos
- Built: the sales page says "no demonstration videos yet" when none are approved, or "N of 19 lessons" when some are; it no longer lists videos as a feature.
- Required before this launch: **instructor approval** of the written course, and your read of that sentence on the day.
- ☐ Launch with no videos  ☐ Approve some videos first (`LESSON-VIDEO-APPROVAL.md`)

## 8. Instructor sign-off
`EDITORIAL-CHECKLIST.md` and `LESSON-VIDEO-APPROVAL.md`. Module 6 stays as written (decided). The 6.4 field test and the 3.3 / 5.3 video briefs stay drafts.
- ☐ Instructor has approved the 19 lessons, drills and safety notice: name ____________________ date ________

## 9. Order of operations
Preview test (Stripe test mode) → instructor and legal pages done → you set the production price and publish → `ACADEMY_LAUNCH=1` last.

Owner: ______________________  Date: __________

# Academy: decisions for approval

**Nothing on this page is final.** The proposals are starting points for the owner, the instructor and
whoever advises on legal and tax matters. I am not a lawyer or a tax adviser, and none of this is legal
or tax advice. Behaviors marked "built" exist in the code; policies are only proposals until you adopt them.

## 1. Price
| | |
|---|---|
| Approved | **$29.00 USD one-time, for isolated preview testing only** |
| Not decided | The production price. Nothing is applied to production. See `PRICING-PROPOSAL.md` |

## 2. Refunds
| | |
|---|---|
| Built | Full refund revokes access; partial refund keeps it |
| Proposal to consider | A stated window (for example 14 or 30 days) and who decides; whether "I changed my mind" qualifies; how a refund is requested. Digital courses have different consumer rules in different places, which a lawyer should check |
| You decide | Window, conditions, wording. It must be linked from the sales page and checkout before any sale |

## 3. Tax
| | |
|---|---|
| Built | Nothing: checkout does not collect tax |
| Options | (a) Stripe Tax with the price tax-exclusive; (b) price tax-inclusive with Stripe Tax; (c) no collection (only if a tax adviser says it is correct for you) |
| You decide | The option, and where you are registered. Sales tax on digital goods varies by state and country |

## 4. Chargebacks
| | |
|---|---|
| Built | Nothing automatic; a dispute does not change access |
| Proposal | Flag the dispute, keep access while you gather evidence, revoke only if the dispute is lost (`CHARGEBACK-PROPOSAL.md`) |
| Alternative | Suspend access immediately on a dispute (more protective against fraud, harsher on honest mistakes) |
| You decide | Which, whether to build it before launch or handle disputes by hand with a written process, and who is notified |

## 5. Terms and Privacy
| | |
|---|---|
| Built | Neither exists on the site |
| Needed | Terms of sale (digital course, license to use, no resale), a Privacy policy covering purchasers (name, email, purchase record, progress, analytics events), the refund policy text, a support contact |
| You decide | The text, reviewed by a lawyer |

## 6. Launching without videos
| | |
|---|---|
| Built | The sales page states the video situation from the data: "no demonstration videos yet" when none are approved, "N of 19 lessons" otherwise. It no longer lists videos as a feature. Customers only ever see approved, working links |
| Required before you may launch this way | **Instructor approval** of the written course, and your read of that sales-page sentence to confirm it is accurate on the day |
| You decide | Launch with zero videos, or approve some first |

## 7. Instructor items
Lessons, drills, safety notice, preview lesson, credibility block, the optional 6.4 and 3.3 / 5.3 drafts (kept as drafts; Module 6 stays as written). Checklist: `LESSON-VIDEO-APPROVAL.md`, `EDITORIAL-CHECKLIST.md`. Nothing is approved today.

## 8. Order of operations
1. Isolated preview: run `STRIPE-TEST-CHECKLIST.md` (test mode, synthetic buyers).
2. Instructor signs off; legal and tax pages exist.
3. You set the production price and publish; `ACADEMY_LAUNCH=1` last.

Owner: ______________________  Date: __________

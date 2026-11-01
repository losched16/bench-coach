# Who can open the course: entitlement matrix

Access to paid lessons comes from one thing: an **active enrollment row**, written only by the server
after Stripe confirms payment (or by the owner's manual grant). A redirect, a team role and a subscription
grant nothing. Each row says where it is tested.

| Situation | Result | Tested by |
|---|---|---|
| A paid Checkout completes | Buyer is enrolled, payment recorded | unit: "a paid course checkout enrolls the buyer", "...and records how it was paid" |
| The buyer comes back from Stripe before the webhook | The server asks Stripe about the session; the return link alone grants nothing | unit: "an unpaid session grants nothing"; browser e2e: "a made-up return URL grants nothing" |
| Unpaid or unfinished session | Nothing | unit: "an unpaid session grants nothing" |
| Price or currency differs from what the checkout **offered**, a different buyer, unknown buyer, unknown course | Nothing, no row left behind, and (because money was taken) flagged NEEDS_REVIEW for the owner | unit: "a different price grants nothing" and the five checks after it, "no rejected attempt left a row behind" |
| **The owner changes the price while a buyer is mid-checkout** | The buyer who paid the price they were shown is enrolled; nothing is dropped | unit: "PRICE CHANGED MID-CHECKOUT", "a currency change after checkout started", "webhook: the price-changed payment enrolls"; browser e2e: "PRICE CHANGED MID-CHECKOUT: the buyer who paid is enrolled exactly once" |
| A paid payment is refused for any reason | Recorded as NEEDS_REVIEW, shown in `/admin/academy`, never silent | unit: "webhook: a paid-but-refused payment is recorded as NEEDS_REVIEW", "...flagged for a person" |
| Same webhook delivered twice | One enrollment | unit: "the same session again is a no-op", "two simultaneous deliveries of one payment enroll once", "webhook: the same event replayed is skipped" |
| Buyer pays twice for a course they own | Access unchanged; flagged `duplicate_purchase` for a manual refund | unit: "a second purchase of an owned course changes nothing" |
| Delayed payment fails | Nothing granted | unit: "webhook: a failed delayed payment is recorded, grants nothing" |
| Database fails during fulfilment | Error returned so Stripe retries; nothing half-written | unit: "webhook: a database failure throws (Stripe retries) and records nothing" |
| **Full refund** | Access ends; progress kept | unit: "a full refund ends access", "webhook: a full refund of a course ends access"; browser e2e |
| **Partial refund** | Access stays | unit: "a partial refund leaves access alone" |
| Buy again after a refund | The same enrollment is reactivated, once | unit: "buying again after a refund reactivates the same enrollment" |
| Refund of something that is not a course | Ignored | unit: "a refund for something that is not a course is ignored" |
| A subscription checkout | Never an Academy purchase | unit: "a subscription checkout is never an Academy purchase", "webhook route: only subscription-mode checkouts can change a coach plan" |
| An Academy purchase | Never touches the BenchCoach subscription | unit: "a course purchase NEVER touches the coach subscription" |
| A BenchCoach subscriber | No free course; a buyer gets no subscription | design + the two rows above |
| A team role (owner, admin, contributor, viewer) | No course access unless they bought it | design: access reads enrollments only; Postgres policy test |
| Signed-out visitor | Sales page and the free preview lesson only; paid text unreachable | Postgres policy test (`test:migration-080`), browser e2e ("sales page carries no paid lesson text") |
| Another signed-in user | Cannot read someone else's enrollment, progress or lessons | Postgres policy test, browser e2e (unauthorized access) |
| Owner grants or revokes by hand | Recorded with who did it | browser e2e: "the owner can revoke an enrollment", "the owner can grant (comp) access"; Postgres policy test: no client can write enrollments |
| Launch flag off | Checkout, confirm and tracking answer 404 for everyone; existing customers keep access; the owner can preview pages | `test:academy-flag-off` (19 checks) |
| Unapproved video | Never shown to customers | unit: "no fabricated approved video status anywhere in code"; browser e2e (candidate and broken links hidden) |
| **Dispute opened** | Recorded; access stays on while the owner investigates | unit: "dispute opened: recorded, and access STAYS ON"; browser e2e |
| **Dispute lost** | Access ends (`stripe_dispute_lost`) | unit: "dispute LOST"; browser e2e |
| **Dispute resolved in our favor, or funds reinstated** | Access restored, but only if the dispute ended it | unit: "RESTORED", "funds reinstated", "never restores a refunded enrollment", "never restores access the OWNER ended"; browser e2e |
| Dispute events out of order or repeated | Harmless | unit: "OUT OF ORDER", "the same event replayed is skipped" |

Gap, said plainly: no real Stripe account has been used yet (a local fake Stripe stands in for every row above).

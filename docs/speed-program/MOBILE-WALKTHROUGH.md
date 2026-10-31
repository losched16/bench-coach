# Mobile walkthrough: synthetic data only

Use with `MOBILE-QA.md` (the tick-list). This is the *script*: exactly what to tap
and type, so two testers get comparable results. Run it only in the **isolated
preview** (`docs/preview/README.md`) with the `ZZ-SYN` data. If the page shows a
real child's name, stop: you are in the wrong environment.

Accounts (made up, created in the preview project only): `owner.syn@`, `admin.syn@`,
`contrib.syn@`, `viewer.syn@`, `outsider.syn@` `example.test`.
Players on "ZZ-SYN Team One": ZZ-SYN Player A, B, C. Team Two has Player D (use it only
to check the outsider cannot see team one).

Phone: portrait, one thumb, outdoors for steps 5 and 9 if you can.

| # | Sign in as | Do this | You should see |
|---|---|---|---|
| 1 | owner | Roster, ZZ-SYN Player A, Development tab | A "Speed, Agility & Explosiveness" card, "Not assigned yet" |
| 2 | owner | Open it. Choose **Development**. Games 1, hard practices 1, space Open outdoor | Suggested sessions 1 with the reason; choosing 3 shows an amber warning but still lets you assign |
| 3 | owner | Set sessions to 3, tap Assign | "Development · Week 1 of 4: Learn", Sessions A B C chips |
| 4 | owner | Read Session A | Wall drive 2 × 5 per leg, 30 sec; falling start 1 × 4, 45–60 sec; 10-yard 1 × 3, 60–90 sec; chase 1 × 4. Each video says "External reference · not yet reviewed" |
| 5 | owner | Tap Log this session on A. Braking **2**, Reaction **2**, fatigue Some. Save | History shows "Session A · Braking 2 · Reaction 2". Reload: still there |
| 6 | owner | Under Moving on, "Move to week 2" | "Needs two completed sessions"; Coach override opens a box; the button stays disabled until you type 10+ characters |
| 7 | owner | Log B: Braking 2, Reaction 2. Save | "Move to week 2" now shows **Advance**. Tap it: Week 2 of 4: Build |
| 8 | owner | Log C with **Landing 2, Reaction 2** and tick **Pain**. Note "synthetic test" | The guidance box turns amber: do not add work. Every Advance says blocked until a pain-free session, no override offered |
| 9 | owner | Change Space to **Indoor**. Look at Session A | Falling start shows "lean-and-catch ... two quick low steps (about 2 yards) ... 10 ft clear"; 10-yard shows the 2–3-yard takeoff and brake |
| 10 | owner | Baseball: add a result > Type: only "Movement quality" is offered while indoors. Switch Space back to Open outdoor, add **Timed**, 10-yard sprint, **2.31**, grass, stopwatch, standing start, baseline | Saved under "10-yard sprint, Baseline" |
| 11 | owner | Add a **Retest**, **2.20**, surface **turf** | "not compared. Different surface." and no number |
| 12 | owner | Add another retest **2.22**, surface **grass** | "change -0.09 s" and no words like better or faster |
| 13 | owner | Session A, wall drive, Adjust: sets 1, note "synthetic" | Marked "coach-adjusted"; reload keeps it; Foundation/Advanced untouched |
| 14 | viewer | Open Player A's program | Readable; no Log, Advance, Adjust or controls |
| 15 | contrib | Open it | Log this session is there; Moving on says only a head coach or admin can advance |
| 16 | outsider | Open the same address | "Not available" (and never a hint the program exists) |

Write on the QA sheet any step where the text is hard to read, a button is hard to hit,
the keyboard hides Save, or anything scrolls sideways. Do not enter real names, photos or
birthdates at any step.

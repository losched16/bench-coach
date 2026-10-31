# Real-device mobile QA: Speed, Agility & Explosiveness

Do this on a real phone, outdoors if possible, before anyone says "ready".

> The step-by-step script with exact values is `MOBILE-WALKTHROUGH.md`. The isolated preview is described in `docs/preview/README.md`; exact setup is in `docs/preview/SETUP-STEPS.md`. Synthetic data only.

## Where to run it (read first)

- **There is no preview deployment for this branch yet.** The Vercel project
  shows no deployment for `claude/agility-pathway`. Creating one is a deployment,
  so it needs your approval.
- **Do not QA on production data.** A Vercel preview normally uses the same
  Supabase keys as production. A coach logging sessions for a real child there
  would write a real child's record. Use a separate Supabase project (or a
  Supabase branch) with its own test team and a made-up player, or run locally.
- The feature needs two switches, both yours to make: apply
  `081_speed_program.sql` to the QA database, and set `SPEED_PROGRAM=1` on the QA
  deployment only (never on production).
- Before applying 081 anywhere, run `scripts/speed-program/verify-prod-readonly.sql`
  PART 1 (read-only). After applying, run PART 2.

## Devices

At least one iPhone (Safari) and one Android phone (Chrome), portrait. Note model
and OS version here: ______________________

## Accounts (all on the test team)

Head coach (owner) · Admin · Contributor · Viewer · a user on no team.

## Checklist

Tick each, write what you saw.

**Assign (owner or admin)**
- [ ] The Development tab shows the Speed, Agility & Explosiveness card; tapping it opens the page.
- [ ] The level cards read clearly and say age is advisory. Foundation and Advanced say "Draft variant".
- [ ] Changing games and hard practices changes the suggested sessions; picking more shows a warning but still lets you assign.
- [ ] Picking indoor shows the 20×15 ft note. Assign works with one thumb; no zooming needed.

**Read the plan (outdoors, phone in hand)**
- [ ] Session A, B and C are readable in sunlight at normal brightness: sets, reps, rest, cue.
- [ ] Nothing scrolls sideways. Text does not clip. Buttons are easy to hit with a thumb.
- [ ] Each video link opens the original post in a new tab, shows the creator's name, and says "not yet reviewed". Nothing says verified or approved.
- [ ] Indoor mode shows the lean-and-catch text for the falling start and the short takeoff for the 10-yard.

**Log a session**
- [ ] Open the log form; the keyboard does not hide the Save button.
- [ ] 0 / 1 / 2 buttons are large enough; "not observed" is possible; only the scores that session can observe are shown (landing only on session C).
- [ ] Mark pain: the pain note appears. Save. The guidance turns amber and says not to add work.
- [ ] Reload: the session is still in History with the scores.
- [ ] Skip a session with a reason; it appears as skipped with no scores.

**Advance**
- [ ] With one session, "Move to week 2" says it needs two sessions and offers an override.
- [ ] The override button stays disabled until at least 10 characters are written.
- [ ] After pain was logged, every advance says it is blocked and no override is offered.
- [ ] After two clean sessions the Advance button appears and works; the week changes.

**Adjust and baseline**
- [ ] Change sets or reps for one exercise; it is marked coach-adjusted and survives reload.
- [ ] Remove a video reference; it disappears for this player only.
- [ ] Record a 10-yard baseline outdoors, then a retest on a different surface: it says "not compared" and why. Same conditions: it shows a change in seconds with no "better/worse" wording.
- [ ] Indoors, timed tests are not offered.

**Roles**
- [ ] Viewer: can read, sees no Log, Advance or Adjust controls.
- [ ] Contributor: can log; cannot assign, adjust or advance.
- [ ] The user on no team gets "not available" and cannot see the player.

**Flag**
- [ ] With `SPEED_PROGRAM` unset the card is gone and the page is not found.

## Results

Tester: ______________  Date: ________  Device(s): ______________
Blocking problems: ______________________________________________
Do not enable until every box is ticked or has a written reason.

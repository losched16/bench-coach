# Academy drill videos (lesson drills borrow a library video)

**Status: library drill videos are merged (#35, migration 083 applied). Pasted YouTube links are built on branch `claude/academy-pasted-videos` (PR #36). Migration 084 is applied to the live database (2026-11-04, owner-verified); the app code is not merged yet. Nothing is approved.**

## What it does
Each Academy lesson has drills ("Drill A", "Drill B"). Your BenchCoach drill library already holds a curated YouTube video
for most drills, and the development plans play it inline. This lets you point a lesson drill at one library drill so the
lesson plays that same video the same way (`DrillVideo`). Only the **video** is borrowed. The lesson keeps its own words;
no library text is copied.

## How you use it (owner only, `/admin/academy` → "Drill videos")
1. Find the lesson drill. Search the library by name and tap **Use this** on the matching drill. Add a **start second** if the
   drill begins partway through the video. It is saved as a **candidate**. Learners cannot see candidates.
2. The page plays the video for you. Watch all of it.
3. Enter your name, tick "I watched the whole video and it is right for this drill, safe and suitable for the age group", and
   **Approve for learners**. The reviewer name and date are stored. Only then does the lesson show it.
4. Change the drill or the start time later and it goes **back to candidate**. An approval is for one exact video and start.
   **Retire**, **Reject** and **Remove** hide it again at any time.

## Rules the code enforces
- Only **approved** mappings reach a learner. Approval needs a named reviewer, a date and "I watched it" (API and database).
- **Compilations:** if the library video is used by several drills and no start time is set, it opens at 0:00 of something
  covering other drills. Approval is refused until you give this drill's start time, or tick that opening at the beginning is fine.
- A drill with no approved video shows the written drill only, exactly as before. A retired or missing library drill or a drill
  with no YouTube video means "no video", never an error.
- The sales page counts lessons with an approved video (link or drill video) from the data, so it never claims more than exists.
- The owner's admin API is owner-only. Learners and the public have no write path.

## What changed from the earlier "link out only" rule
The first Academy build only linked to videos and never embedded. You asked for the same inline video the development plans use,
so approved drill videos play in the lesson through YouTube's own player (the same component the plans use). The approval rule is unchanged.

## Not done / needs you
- **Approving any video.** I have not approved, matched or chosen any video. The library videos were curated for coaching plans;
  whether each is right for the *course* is your call.
- **PR #35 must be merged and deployed** before the admin screen appears. Migration 083 is already applied; the table is empty and unused until then.
- Library coverage: some library videos are compilations with no start time (the app already knows this). Those need a start second.

## No video in the library? Paste a YouTube link (migration 084)
If the library has no video for a lesson drill, find one yourself on YouTube (app or browser), copy the link, and paste it into
the drill's row ("No library video? Paste a YouTube link", then **Use link**). BenchCoach asks YouTube whether the video exists and
can be played here, and stores the title and channel YouTube reports. A start time inside the link (`?t=95`) is kept. It then
follows the same rules as a library video: **candidate** until you watch it and approve it with your name and "I watched the whole video".
- Only `https://youtube.com` / `youtu.be` links are accepted. Other sites and plain text are refused.
- YouTube is asked again at approval, so a video that was removed in between cannot be approved.
- Switching a drill to a library video (or another link) clears the old one and returns it to candidate.
- Migration 084 is applied. Pasting works once PR #36 is merged and deployed; library videos keep working throughout.
- Nothing is approved for you. The search is yours: I can suggest search phrases but I cannot judge a video.

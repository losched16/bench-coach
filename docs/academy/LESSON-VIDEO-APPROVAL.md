# Academy: lesson and video approval checklist

Nothing in the course is approved today. This is the sheet the instructor works through,
lesson by lesson. A lesson or video counts as approved only when its row is complete **and
signed**. Until then learners see the written lesson only.

Three items are review **drafts** written by the assistant (they are in the
private, git-ignored folder `.academy-content/review-drafts/`, not in the database): an optional field
test and "ready" statement for 6.4 (the original completion checkpoint is retained), and the video briefs for 3.3 and 5.3. They need the same
review as everything else, and a stricter one, because the author did not write them.

## A. Lessons (19)

For each: read the lesson as a parent or volunteer coach would. Tick when true.

| Lesson | Title | Instructionally sound | Safe for the age/level it targets | Cue, drill and "ready" agree with each other | Matches the course voice | Initials / note |
|---|---|---|---|---|---|---|
| 1.1 | The grip: control the bat without fighting it | ☐ | ☐ | ☐ | ☐ | |
| 1.2 | The stance: create an athletic starting position | ☐ | ☐ | ☐ | ☐ | |
| 1.3 | Posture: stay athletic while the bat moves | ☐ | ☐ | ☐ | ☐ | |
| 2.1 | Rhythm and the first move: start on time | ☐ | ☐ | ☐ | ☐ | |
| 2.2 | The lower-body load: gather without swaying | ☐ | ☐ | ☐ | ☐ | |
| 2.3 | The upper-body load: turn without wrapping | ☐ | ☐ | ☐ | ☐ | |
| 3.1 | The stride: how much movement is enough? | ☐ | ☐ | ☐ | ☐ | |
| 3.2 | The forward move: control momentum | ☐ | ☐ | ☐ | ☐ | |
| 3.3 | The launch position: ready to rotate, not frozen | ☐ | ☐ | ☐ | ☐ | |
| 4.1 | Where power begins: coordinated movement, not an arm swing | ☐ | ☐ | ☐ | ☐ | |
| 4.2 | Hip and torso rotation: sequence without spinning out | ☐ | ☐ | ☐ | ☐ | |
| 4.3 | Intent and bat speed: swing with purpose, keep the barrel under control | ☐ | ☐ | ☐ | ☐ | |
| 5.1 | Bat path: find the moving ball | ☐ | ☐ | ☐ | ☐ | |
| 5.2 | Contact point: inside, middle and away are different | ☐ | ☐ | ☐ | ☐ | |
| 5.3 | Contact direction and posture: stay organized through impact | ☐ | ☐ | ☐ | ☐ | |
| 6.1 | Timing: a good swing at the wrong time is still a miss | ☐ | ☐ | ☐ | ☐ | |
| 6.2 | Swing decisions: learn which pitch to attack | ☐ | ☐ | ☐ | ☐ | |
| 6.3 | Adjustability: different pitch, same simple plan | ☐ | ☐ | ☐ | ☐ | |
| 6.4 | Putting it all together: the complete hitter's routine | ☐ | ☐ | ☐ | ☐ | |

Also: ☐ intro pages (welcome, how to use, starting assessment) read and approved ·
☐ resources (four-week program, session card, troubleshooting) read and approved ·
☐ the course safety notice is correct and complete · ☐ the free preview lesson (1.1) is one you are happy to give away.

**Drafts (not approved, not in the course):**
6.4: **the original Module 6 completion checkpoint is retained** (decision); the 6.4 field-test/"ready" draft is optional and only for later consideration ·
☐ 3.3 video brief (draft) accepted / edited / rejected · ☐ 5.3 video brief (draft) accepted / edited / rejected.

## B. Videos (0 of 19 approved)

For each lesson, find at most a few candidate videos. For **each** candidate, all of these must be true before it
is approved:

- ☐ It teaches what the lesson's brief asks for, and agrees with the lesson text.
- ☐ A qualified person has **watched the whole video**, not just the thumbnail.
- ☐ It is safe: appropriate equipment and setting, no unsafe practice, nothing that contradicts the lesson's safety notes.
- ☐ It is suitable for the age group the lesson targets.
- ☐ It does not promote a fixed "ideal" the course rejects (frozen finish, forced counter-rotation, one stance for everyone).
- ☐ The creator is named correctly and will be credited on the page.
- ☐ You have permission or a licence to link (BenchCoach links out and does not embed or host the video).
- ☐ The link opens, is public, and is not region-locked or age-gated.
- ☐ The page the learner lands on has no content that would embarrass or endanger a parent or child.
- ☐ Reviewed on (date) ________ by (name) ________.

Record an approved video with a SQL statement like the one below. The database refuses
`approved` unless a reviewer and a date are present, and the app shows only `approved`
links whose `link_status` is not `broken`. (There is no admin screen for this yet; it is a
decision for you whether to build one before launch.)

```sql
-- One candidate you have reviewed. Edit the quoted values; nothing is applied until you run it.
INSERT INTO public.academy_video_links
  (course_id, lesson_key, title, creator, watch_url, supported_skill, approval_status, reviewed_by, reviewed_at, age_fit, safety_notes, link_status, last_checked_at, position)
SELECT id, '1-1', 'TITLE AS SHOWN', 'CREATOR NAME', 'https://...', 'what it shows', 'approved', 'REVIEWER NAME', now(), 'ages 8-12', 'any caution', 'ok', now(), 1
FROM public.academy_courses WHERE slug = 'build-a-better-baseball-swing'
ON CONFLICT (course_id, lesson_key, watch_url) DO NOTHING;

-- Withdraw one later:
-- UPDATE public.academy_video_links SET approval_status = 'retired' WHERE watch_url = 'https://...';
```

Lessons with no approved video are not a defect: they ship as written lessons. You may launch with zero videos.

## C. Sign-off

Instructor: ____________________ Credentials: ____________________ Date: ____________

☐ All 19 lessons approved (or the exceptions are listed in the notes) ☐ Videos approved: ___ of 19 ☐ Safety notice approved

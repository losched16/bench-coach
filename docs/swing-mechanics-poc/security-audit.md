# Swing video security audit (2026-10-18)

Scope: every place the app stores, uploads, signs or serves swing video, and the
team/player authorization in front of it. Findings that need owner action, with their
details, were sent to the product owner privately. This file records the controls, the
open actions in general terms, and read-only verification steps.

## Inventory

| Path | Storage | How video is served | Authorization |
|---|---|---|---|
| **Swing mechanics POC** (`/api/swing-poc/*`, flag-off) | local private dir (`SWING_POC_DATA_DIR`), outside `public/`, git-ignored | `/api/swing-poc/captures/[id]/video` only: session + `authorizePlayer` for the capture's stored team/player, plus a 5-minute HMAC token bound to user + capture; range-streamed with `Cache-Control: private, no-store`. The browser playback copy is served the same way, and only if its alignment check passed and its file name is the worker's own | `lib/authz.ts` (role + player scope); ids are server UUIDs, never paths |
| Legacy swing analysis (UI not mounted) | Supabase storage | see private report | coach-level check only |
| Log screenshots / journal media | Supabase storage | short-lived signed URLs | storage policies (dashboard-managed) |
| PR #10 (draft, unmerged) | Supabase storage, team/player-scoped paths | signed upload token; signed read | `authorizeTeam('record')` + team_players check |

## Open actions (owner)

1. **Legacy swing video storage — verify and lock down** (details and exact steps sent
   privately). Do this before any further swing work reaches real users.
2. **Retire the legacy swing analysis path** or bring it under the same controls as the POC
   (server-side authorization, private storage, validated inputs).
3. **Capture storage policies in a migration** so they are reviewed like code; today they
   live only in the Supabase dashboard.

## POC notes

- The signed token travels in the video URL query string, so it appears in request logs. It is
  short-lived and bound to one user and capture; no identity, frame or file content is logged.
  Acceptable for the POC; production should use cookie-scoped or storage-native signed URLs.
- Viewers (read-only team members) can watch swing video, matching the app's existing `read`
  capability. Revisit when parent or helper roles get access.
- Retention: `python -m swing_analyzer purge --data-dir … --older-than-days N` deletes old
  captures with everything derived from them.
- Validation runs (`validate`) write only to a git-ignored, owner-only folder, refuse a folder
  git would track, and never record the input's file name. A test asserts that no video,
  frame, still or model file is tracked by git.

## Owner verification (read-only)

Dashboard: **Storage → Buckets**: every bucket holding player media must show *Private*.
**Storage → Policies**: no policy on `storage.objects` for those buckets should apply to
`anon`/`public` or lack an `auth.uid()` condition.

SQL editor (read-only):

```sql
select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id;

select bucket_id, count(*) as objects from storage.objects group by bucket_id order by bucket_id;

select policyname, permissive, roles, cmd
from pg_policies where schemaname = 'storage' and tablename = 'objects' order by policyname;
```

## Production storage plan

A private bucket (`public = false`, `file_size_limit` 200 MB, `allowed_mime_types` = video/mp4,
video/quicktime, video/webm), paths `<team>/<player>/<uuid>.<ext>`, uploads through
server-issued signed upload tokens after `authorizePlayer(…, 'record')`, reads through
server-issued signed URLs of 5 minutes or less, policies in a migration, and the 180-day
expiry in `proposed-schema.sql`.

# BenchCoach Content Inbox automation

This workflow turns a saved public Instagram Reel URL in the Notion **BenchCoach Content Inbox** into a review-ready content brief and short reaction/remix script.

It does **not** publish content, change the BenchCoach drill library, or mark a source as visually verified.

## What it does

Every 30 minutes, GitHub Actions checks Notion for Content Inbox rows with `Status = Inbox` and a `Source URL`.

For each eligible row it:

1. Normalizes the Instagram URL.
2. Sends the public Reel URL to the Apify Instagram Reel transcript actor.
3. Stores available creator metadata, source caption, transcript, and media URL.
4. Sends the source evidence plus Clint's `Clint Take` / `Quick Note` to Claude.
5. Writes back:
   - AI Summary
   - Skill
   - Drill / Concept
   - Problem It Solves
   - BenchCoach Angle
   - Content Job
   - 3-5 Hook Candidates
   - selected Hook
   - Script Draft
   - CTA
   - Format
6. Moves the row to `Status = Reviewed`.

When a transcript is available, the row becomes `Automation State = Ready` with `Evidence Basis = Transcript + Metadata`.

When transcript evidence is unavailable but Clint supplied enough context to draft responsibly, the row becomes `Automation State = Manual Review` with `Evidence Basis = Manual Note Only`.

Any retrieval/model error is written to `Processing Error` and marked `Automation State = Error`.

## Evidence and reuse guardrails

The automation keeps the Instagram drill-intelligence pilot's core rule: **one Reel is not necessarily one drill**. A Reel may contain one drill, several drills, a progression, a coaching cue, or something that should not become content.

V1 is transcript/metadata-first. It never claims to have visually verified a drill or mechanic. `Evidence Basis = Visual Verified` is reserved for a later visual-review step.

The generated script must transform the source rather than reproduce it. It should credit the creator when known, add Clint's coaching interpretation, and connect the lesson to BenchCoach only where useful.

The workflow never changes `Permission` or `Remix Available`; those remain human decisions.

## One-time activation

The workflow is committed **disabled**. Configure these before enabling it.

### 1. Notion

Create or reuse a private Notion integration that can edit the **BenchCoach Content Inbox** database, then share that database with the integration.

Add its token to GitHub repository secrets as:

- `NOTION_CONTENT_TOKEN`

Never commit the token.

### 2. Apify

Use an Apify account with access to:

- `fguiraud/instagram-reels-transcript-scraper`

Add the Apify API token to GitHub repository secrets as:

- `APIFY_TOKEN`

The processor sends one public Reel URL at a time and requests Whisper transcription.

### 3. Anthropic

Add a valid Anthropic API key to GitHub repository secrets as:

- `ANTHROPIC_API_KEY`

The default model is `claude-sonnet-5`.

### 4. Enable

After all three secrets exist, create this GitHub Actions repository variable:

- `BENCHCOACH_CONTENT_AUTOMATION_ENABLED` = `true`

Until that variable is exactly `true`, both scheduled and manual workflow jobs are skipped.

## First test

Use the existing Content Inbox item **How to coil**.

Confirm it has:

- a public Instagram `Source URL`
- `Status = Inbox`
- `Automation State = Queued`

Then run **Actions -> BenchCoach Content Inbox -> Run workflow**.

A successful pass should move it to `Reviewed`, populate source/transcript fields, generate hook candidates and a script, and set the automation state to `Ready` or `Manual Review`.

## Retrying errors

Scheduled runs skip rows marked `Error` to avoid repeatedly burning API credits.

After correcting the cause, set `Automation State` back to `Queued`, or run locally with:

```bash
node scripts/content-inbox/process.mjs --retry-errors
```

## Local dry run

A dry run still calls Apify and Claude, but does not write back to Notion:

```bash
NOTION_CONTENT_TOKEN=... \
APIFY_TOKEN=... \
ANTHROPIC_API_KEY=... \
node scripts/content-inbox/process.mjs --dry-run
```

## Cost controls

The workflow processes at most three rows per run by default. `CONTENT_INBOX_BATCH_SIZE` may be set from 1-10.

Rows already in `Ready` or `Processing` are skipped. Error rows are skipped unless explicitly retried.

## Future V2: visual review

A later V2 can retrieve the media, extract representative frames, run visual review, and then upgrade `Evidence Basis` to `Visual Verified`. That phase should reuse the existing `scripts/pilot/download-media.mjs` and frame-extraction safeguards rather than inventing a second media pipeline.

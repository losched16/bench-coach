# The 26 source collections, broken into the activities they actually contain.
#
# A collection row is not a drill, but the video behind it is not worthless —
# several of them name their constituent drills outright, and a good number of
# those drills ALREADY EXIST as canonical rows in this library. This file records
# which, so Phase 2B can attach the same video to each activity as media rather
# than leaving 26 rows demoted and forgotten.
#
# ON TIMESTAMPS — read before filling any in.
#
# Every timestamp_candidate below is EMPTY. Not "0", not a guess from the drill's
# position in the list: empty. This pass had no transcripts, no YouTube chapter
# data, and no verified viewing of any video. A plausible-looking number here
# would be indistinguishable from a real one to whoever reads this next, and the
# whole point of the media layer is that "nobody has said where in the video this
# drill is" stays distinguishable from "it starts here".
#
#   python3 scripts/build-collection-extraction.py

import csv, json, sys

LIB = {d['drill_name']: d['id'] for d in json.load(open('scripts/fixtures/drill-library-snapshot.json'))}

# Keyed by id, with a name index alongside — because TWO collections share the
# name "10 Best Baseball Hitting Drills for Kids" and the same category, and a
# name-keyed dict silently dropped one of them. A collection disappearing from
# an audit of collections is exactly the failure this file exists to prevent,
# so an ambiguous key is a hard error rather than a last-one-wins.
_ALL = json.load(open('scripts/fixtures/source-collections.json'))
COLL_BY_ID = {c['id']: c for c in _ALL}
_BY_NAME = {}
for c in _ALL:
    _BY_NAME.setdefault(c['drill_name'] + '|' + c['skill_category'], []).append(c)

def resolve(key):
    """A collection by 'name|category', or by id when the name is ambiguous."""
    if key in COLL_BY_ID:
        return COLL_BY_ID[key]
    hits = _BY_NAME.get(key, [])
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        raise SystemExit(
            f'"{key}" matches {len(hits)} collections — reference it by id instead:\n  ' +
            '\n  '.join(h['id'] for h in hits))
    return None

# collection_key, candidate activity, canonical match name (or ''), action, notes
ROWS = [
 # ── CATCHING — led, because it carried a coverage blocker ──────────────────
 ('Top 5 Blocking Drills for Catchers|Catching','Pre-Set Blocks','','NEW_CANONICAL','Named in the video description. A static start position before any movement — the first rung of a blocking progression the library has no rows for.'),
 ('Top 5 Blocking Drills for Catchers|Catching','Side-to-Side Slides','','NEW_CANONICAL','Named. Lateral blocking movement; distinct from the pre-set because the catcher has to move to the ball.'),
 ('Top 5 Blocking Drills for Catchers|Catching','Twist and Block','','NEW_CANONICAL','Named. Angling the chest back toward the plate — the rule that turns a blocked ball into a controlled one.'),
 ('Top 5 Blocking Drills for Catchers|Catching','Inch Worms','','NEW_CANONICAL','Named. A conditioning-and-recovery pattern between blocks.'),
 ('Top 5 Blocking Drills for Catchers|Catching','Rapid Fire','Game-Speed Reaction Blocking','EXISTING_CANONICAL','Named as the final rung. The library already holds a game-speed read-and-react blocking drill; attach this video as a second angle rather than adding a row.'),
 ('Catcher Footwork Skills and Drills|Catching','Receiving stance','Youth Receiving Foundations — Quiet Glove & Soft Hands','EXISTING_CANONICAL','Description names the stance segment; the existing row covers it.'),
 ('Catcher Footwork Skills and Drills|Catching','Secondary stance with runners on','','NEW_CANONICAL','Named and genuinely absent. The stance change when a runner is on is a decision point, not a variation of the primary stance.'),
 ('Catcher Footwork Skills and Drills|Catching','Quick transfer catch-to-throw','','NEW_CANONICAL','Named. The library has a throw-down to second but nothing isolating the transfer itself.'),
 ('Catcher Footwork Skills and Drills|Catching','Pop-up footwork to second','Catcher Throw-Down Footwork to Second','EXISTING_CANONICAL','Named; the existing row is the same activity.'),
 ('3 Simple Framing Drills for Catchers|Catching','Three progressive framing drills','MLB-Style Receiving & Framing Circuit','NEEDS_REVIEW','Three drills, none named. The library holds a five-drill framing circuit that may already contain all three — needs somebody to watch both before splitting.'),
 ('Top 5 Catching Drills for 8U|Catching','Five unnamed 8U catching drills','','NEEDS_REVIEW','No drill is named in the row. Nothing extractable without viewing.'),
 ('Youth Baseball Catching Drills|Catching','Receiving, blocking and throwing','','NEEDS_REVIEW','Three subjects, no named drills. Likely overlaps rows the library already has.'),

 # ── FLY BALLS — the other coverage blocker ─────────────────────────────────
 ('3 Great Outfield Drills for Youth Players|Fielding (Fly Balls)','Drop step mechanics','Outfield Drop Step Drill','EXISTING_CANONICAL','Named in the description and already a canonical row.'),
 ('3 Great Outfield Drills for Youth Players|Fielding (Fly Balls)','Fly ball tracking','Fly Ball Confidence Ladder','NEEDS_REVIEW','Related to the rescue activity written in migration 063, but tracking and confidence are not the same drill. Worth viewing before deciding whether this is a second row or a progression of the ladder.'),
 ('3 Great Outfield Drills for Youth Players|Fielding (Fly Balls)','Catch-to-throw transition','','NEW_CANONICAL','Named. The library has a do-or-die charge on the ground and a crow hop, but nothing on catching a fly ball already moving into the throw.'),
 ('Essential Outfield Drills — Fly Balls and Ground Balls|Fielding (Fly Balls)','Crow hop mechanics','Crow Hop — Arm Strength and Outfield Throwing','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('Essential Outfield Drills — Fly Balls and Ground Balls|Fielding (Fly Balls)','Outfield ground ball technique','Do-or-Die Charge & Throw','EXISTING_CANONICAL','Named; the existing row is the game-situation version of it.'),
 ('Essential Outfield Drills — Fly Balls and Ground Balls|Fielding (Fly Balls)','Catching position for quick transition','','NEW_CANONICAL','Named separately from the crow hop — where the catch is made so the throw can start, which no row covers.'),
 ('2 Outfield Drills for Fly Balls|Fielding (Fly Balls)','Two unnamed fly ball drills','','NEEDS_REVIEW','Neither drill is named.'),
 ('3 Great Drills for Teaching Fly Balls|Fielding (Fly Balls)','Three unnamed progressive drills','','NEEDS_REVIEW','Progressive by description, unnamed. Probable overlap with the Fly Ball Confidence Ladder.'),

 # ── INFIELD ────────────────────────────────────────────────────────────────
 ('3 Simple Fielding Drills for Youth Players|Fielding (Infield)','Proper fielding stance / getting low','The Flamingo Drill','EXISTING_CANONICAL','The stance-and-posture segment is what The Flamingo Drill already teaches.'),
 ('3 Simple Fielding Drills for Youth Players|Fielding (Infield)','Receiving with correct hand position','Groundball Transfer Catch','NEEDS_REVIEW','Hand position on the receive; the existing row covers the transfer that follows it. May be the same drill or its first half.'),
 ('4 High-Energy Infield Drills|Fielding (Infield)','Four unnamed high-tempo drills','','NEEDS_REVIEW','None named. High-tempo infield work is the thinnest part of the library, so this one is worth viewing first.'),
 ('Three Drill Progression|Fielding (Infield)','Three unnamed progression drills','','NEEDS_REVIEW','Explicitly three separate drills; none named.'),

 # ── HITTING ────────────────────────────────────────────────────────────────
 ('7 Best Youth Baseball Hitting Drills|Hitting','Stance Drill','Stance & Athletic Position Drill','EXISTING_CANONICAL','Named; canonical row exists (its duplicate is already marked).'),
 ('7 Best Youth Baseball Hitting Drills|Hitting','Stride Pause to Stride Swing','Stride Pause to Stride Swing Drill','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('7 Best Youth Baseball Hitting Drills|Hitting','PVC Drill for swing axis','PVC Pipe Hip Rotation Drill','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('7 Best Youth Baseball Hitting Drills|Hitting','Mini Wiffle Ball with skinny bat','Mini Wiffle Ball & Skinny Bat Drill','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('7 Best Youth Baseball Hitting Drills|Hitting','Heavy Ball Drill','','NEW_CANONICAL','Named and genuinely absent. Distinct from the overload/underload bat protocol — this loads the BALL, not the bat.'),
 ('0d6f53b2-ca7d-45ae-b0d2-eac1d8c13f9a','Tee work','Tee Work','EXISTING_CANONICAL','Named as a category; canonical row exists.'),
 ('0d6f53b2-ca7d-45ae-b0d2-eac1d8c13f9a','Soft toss variations','Soft Toss','EXISTING_CANONICAL','Named as a category; canonical row exists.'),
 ('0d6f53b2-ca7d-45ae-b0d2-eac1d8c13f9a','Fun competitive drills','The Track and Catch Drill — Head on the Ball','EXISTING_CANONICAL','Two drills were already extracted from this video in an earlier pass — proof that a collection video really does contain genuine activities.'),
 ('ebd5359b-cccd-4249-b2d9-6e66987535eb','The same ten drills as the row above','','NOT_USEFUL','The second of two rows on one video with the same contents. Already marked a duplicate candidate in the Phase 1 audit; nothing further to extract.'),
 ('5 Essential Hitting Drills for Youth Baseball|Hitting','Five unnamed drills with swing analysis','','NEEDS_REVIEW','The row describes the teaching method rather than naming the drills.'),
 ("Fundamentals of Hitting — Coach's Clinic|Hitting",'Full clinic, sequential fundamentals','','NOT_USEFUL','A coach-education clinic, not a set of extractable player activities. Its value is as teaching content for a coach, which is what it is now classified as.'),

 # ── PITCHING ───────────────────────────────────────────────────────────────
 ('Must-Do Youth Pitching Drills for Beginners|Pitching','Balance Point Drill','Balance Point Drill — Leg Lift & Pause','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('Must-Do Youth Pitching Drills for Beginners|Pitching','Knee Drill','Kneel-Down (Wrist Snap) Drill — Release Point & Backspin','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('Must-Do Youth Pitching Drills for Beginners|Pitching','Stride Drill','Stride Direction Drill — Using a Chalk Line or Tape','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('9 Best Pitching Drills for Kids|Pitching','Flamingo','Flamingo Balance Drill — Single-Leg Stability','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('9 Best Pitching Drills for Kids|Pitching','Towel Slap','Towel Drill — Arm Speed & Release Point','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('9 Best Pitching Drills for Kids|Pitching','Kneel of Fortune','Kneel-Down (Wrist Snap) Drill — Release Point & Backspin','NEEDS_REVIEW','Both isolate upper-body rotation from the knees, but the names differ enough that they may be two drills. Worth viewing.'),
 ('9 Best Pitching Drills for Kids|Pitching','Balance Beam (cones for stride path)','','NEW_CANONICAL','Named and absent. The library has a chalk-line stride drill; a cone corridor is a different constraint and a different setup.'),
 ('868fa15d-bfde-4487-83af-d5b27e8962ba','The same nine drills as the row above','','NOT_USEFUL','The second of two rows on video ImeXGqKYP7Y with the same nine drills under a different title. Already marked a duplicate candidate in the Phase 1 audit; extract from the other row.'),
 ('5 Youth Pitching Drills From Your Knees|Pitching','Five unnamed from-the-knees drills','','NEEDS_REVIEW','None named; probable overlap with the kneel-down row.'),
 ('Indoor Team Pitching Drills|Pitching','Unnamed indoor team drills','','NEEDS_REVIEW','Grouped by venue rather than by activity. Indoor-viable pitching work is a real gap worth filling.'),
 ('Rotational Efficiency Drills|Pitching','Two unnamed rotational drills','','NEEDS_REVIEW','Neither named.'),

 # ── THROWING — every named drill already exists ────────────────────────────
 ('10 Best Baseball Throwing Drills for Kids|Throwing','Extreme Catch','Extreme Catch — Progressive Distance Arm Builder','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('10 Best Baseball Throwing Drills for Kids|Throwing','Selfies','Selfies Solo Rebounder — Build Reps Without a Partner','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('10 Best Baseball Throwing Drills for Kids|Throwing','Over Under','Over-Under — Two Ways to Throw and Catch','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('10 Best Baseball Throwing Drills for Kids|Throwing','Clean Up Crew','Clean Up Crew — Fun Fielding-to-Throw Game','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('10 Best Baseball Throwing Drills for Kids|Throwing','Bullseye','Bullseye Challenge — Throwing Accuracy Competition','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('10 Best Baseball Throwing Drills for Kids — Full Progression|Throwing','The same ten activities as the row above','','NOT_USEFUL','A second row on the same video with the same contents. Nothing further to extract; already marked a duplicate candidate in the Phase 1 audit.'),

 # ── BASERUNNING ────────────────────────────────────────────────────────────
 ('Skills and Drills for Baserunning|Baserunning','Leads','Pro Base-Stealing Package — Leads, Reads & Jumps','EXISTING_CANONICAL','Named as a subject; the existing row covers leads and reads.'),
 ('Skills and Drills for Baserunning|Baserunning','Reading pitchers','Steal Breaks — Reading the Pitcher & First Move','EXISTING_CANONICAL','Named; canonical row exists.'),
 ('Skills and Drills for Baserunning|Baserunning','Sliding','Bent-Leg Slide Basics — The Right Way to Slide','EXISTING_CANONICAL','Named; canonical row exists.'),
]

out = []
missing = []
for key, cand, match, action, notes in ROWS:
    c = resolve(key)
    if not c:
        missing.append(key); continue
    mid = LIB.get(match, '') if match else ''
    if match and not mid: missing.append(f'canonical not found: {match}')
    out.append({
        'collection_drill_id': c['id'],
        'collection_name': c['drill_name'],
        'skill_category': c['skill_category'],
        'source_video': c.get('youtube_video_id') or '',
        'candidate_activity_name': cand,
        'candidate_canonical_match': match,
        'canonical_match_id': mid,
        'action': action,
        'timestamp_candidate': '',
        'timestamp_evidence': 'none — no transcript, chapter data or verified viewing in this pass',
        'notes': notes,
    })

if missing:
    print('UNRESOLVED:', file=sys.stderr)
    for m in missing: print('  ' + m, file=sys.stderr)
    sys.exit(1)

path = 'docs/audits/drill-collection-extraction.csv'
with open(path, 'w', newline='') as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader(); w.writerows(out)

from collections import Counter
tally = Counter(r['action'] for r in out)
print(path)
print(f"{len(out)} candidates from {len(set(r['collection_drill_id'] for r in out))} of {len(COLL_BY_ID)} collections\n")
for k, v in sorted(tally.items()): print(f"  {k:<20} {v}")
print(f"\n  collections with no candidate yet: {len(COLL_BY_ID) - len(set(r['collection_drill_id'] for r in out))}")
print(f"  timestamps proposed: {sum(1 for r in out if r['timestamp_candidate'])} (no evidence was available)")

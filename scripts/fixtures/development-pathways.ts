// The four pathways, written down.
//
// This is the editorial content of Phase 2E. Every stage here is a claim about
// what has to be taught before what, and every drill attached to a stage is a
// claim that it teaches or tests THAT stage's objective.
//
// THE RULE THAT DECIDES MEMBERSHIP
//
// A drill belongs to a stage because it teaches or tests the objective. Not
// because its skill_category matches. "Fielding (Infield)" contains drills for
// posture, for approach angles, for the exchange and for double plays — four
// different stages — and "EASY Baseball Catch Drill" is filed under Throwing
// while being the clearest statement of the receiving rule an infielder needs.
// Category is where a drill is filed. A stage is what it is for.
//
// WHAT WAS NOT USED TO ORDER THESE
//
//   alphabetical order        obviously
//   progression_level         62 of 154 drills do not have one, and where it
//                             exists it measures difficulty, not sequence
//   video order               there is none; Phase 2B established that
//   activity family alone     a family is variations of ONE activity
//   age alone                 age is a feasibility filter, not a curriculum
//
// What was used: the description, the coaching notes, the success markers, the
// regression and progression notes, the taxonomy mapping, the activity family,
// the practice role, and — most often — the drill's own words about what has to
// be true before it will work. "A hitter who cannot balance in the stride
// position is not ready for this" is a prerequisite stated by the library.
//
// HONEST GAPS
//
// Three stages are marked NEEDS_EDITORIAL_REVIEW because the library does not
// contain a drill that teaches them. They are kept, with the closest thing
// attached and the gap written down, rather than deleted to make a coverage
// number look better or filled with a drill that merely shares a category.

export type StageDrillRole =
  | 'primary'
  | 'regression'
  | 'reinforcement'
  | 'progression'
  | 'assessment'
  | 'game_application'

export interface StageDrillSpec {
  /**
   * The drill's NAME, not its id.
   *
   * Reviewable: a human can tell whether "Front Toss" belongs in a timing stage
   * and cannot tell anything about eec48dc4-af21-406e-95a2-9db5e22b7596. The
   * emitter resolves names against production and refuses to emit if one is
   * missing, ambiguous, or not schedulable.
   */
  drill: string
  role: StageDrillRole
  rank?: number
  /** Why this drill serves THIS objective. Required, and checked by the emitter. */
  rationale: string
}

export interface StageSpec {
  key: string
  name: string
  /** What the player can do at the end. Observable. */
  objective: string
  whyItMatters: string
  masterySignals: string[]
  commonFailureModes: string[]
  coachingEmphasis?: string
  practicesMin?: number
  practicesMax?: number
  /** problem_taxonomy slugs this stage is aimed at. */
  problems: string[]
  drills: StageDrillSpec[]
  /** Set when the library cannot properly serve this stage yet. */
  review?: string
}

export interface PathwaySpec {
  slug: string
  name: string
  /** A lib/focusAreas FocusArea, not a drill skill_category. */
  skillCategory: string
  summary: string
  applicability: string
  minAge?: number
  maxAge?: number
  provenance: string
  stages: StageSpec[]
}

const PROVENANCE =
  'Phase 2E, 2026-09-17. Sequence written against the 154 schedulable drills as ' +
  'they stood at migration 068, using each row\'s description, coaching notes, ' +
  'success markers and regression/progression notes as evidence. Not derived ' +
  'from progression_level, category, age or video order.'

// ── 1. BUILD THE SWING ──────────────────────────────────────────────────────

const BUILD_THE_SWING: PathwaySpec = {
  slug: 'build-the-swing',
  name: 'Build the Swing',
  skillCategory: 'hitting',
  summary:
    'The swing built from the ground up: a position to swing from, then a way to ' +
    'load it, then a path to the ball, then a moving ball, then a pitcher trying ' +
    'to beat you.',
  applicability:
    'A first-season hitter starts at stage 1. A hitter who already makes contact ' +
    'off a tee usually starts around stage 6 — run stages 1 to 5 as a check rather ' +
    'than as a block of work. Bunting is a separate skill and is not in this pathway.',
  minAge: 6,
  maxAge: 14,
  provenance: PROVENANCE,
  stages: [
    {
      key: 'athletic-stance',
      name: 'Athletic stance and posture',
      objective: 'Sets up balanced, athletic and repeatable without being reminded.',
      whyItMatters:
        'A hitter standing straight up has no axis to rotate around and will sway ' +
        'instead of turning. Every cue in every later stage assumes a body that can ' +
        'hold a position.',
      masterySignals: [
        'Sets up athletic and balanced every time without a reminder',
        'Weight is on the balls of the feet, not back on the heels',
        'Knee bend survives the first movement rather than disappearing at the load',
      ],
      commonFailureModes: [
        'Standing tall with straight legs — no axis to rotate around',
        'Weight back on the heels, so the first move is a step to catch up',
        'Stance looks right standing still and collapses the moment a ball arrives',
      ],
      coachingEmphasis:
        '"Stand like you are about to jump" gets the athletic position faster than ' +
        'any list of body parts.',
      practicesMin: 1,
      practicesMax: 2,
      problems: ['lunging', 'loses-posture', 'stepping-in-bucket'],
      drills: [
        {
          drill: 'Stance & Athletic Position Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'The library describes this as the drill that should precede every other ' +
            'hitting station for a beginner, and it builds the stance from the feet up. ' +
            'Its mastery signals are this stage\'s objective almost word for word.',
        },
        {
          drill: 'Bucket Drill — Stay in Your Legs',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'The bucket makes the leg bend tactile rather than described, and its ' +
            'mastery signal — head at the same height from load to finish — is how you ' +
            'check the stance survived a swing.',
        },
        {
          drill: 'PVC Pipe Hip Rotation Drill',
          role: 'assessment',
          rank: 1,
          rationale:
            'Rotating with a pipe across the shoulders shows whether there is an axis ' +
            'to rotate around at all. Both ends staying level is a direct read on the ' +
            'stance, with no swing involved to confuse it.',
        },
      ],
    },
    {
      key: 'grip',
      name: 'Grip',
      objective: 'Holds the bat with the knocking knuckles roughly aligned, without adjusting mid-swing.',
      whyItMatters:
        'A grip that has to be fixed during the load costs the hitter the load. It is ' +
        'a thirty-second teach that silently limits bat path for a season if skipped.',
      masterySignals: [
        'Knocking knuckles roughly aligned without being adjusted',
        'Grip is found the same way every time the bat is picked up',
        'Hands stay relaxed rather than white-knuckled at set-up',
      ],
      commonFailureModes: [
        'Bat gripped in the palms rather than the fingers',
        'Knuckles rolled so far the wrists cannot hinge',
        'Re-gripping during the load, which restarts the swing',
      ],
      practicesMin: 1,
      practicesMax: 1,
      problems: ['casting', 'rolling-over'],
      drills: [
        {
          drill: 'Stance & Athletic Position Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'The only schedulable drill in the library that addresses the grip at all. ' +
            'It does so in one clause of its set-up and one mastery signal, which is ' +
            'enough to teach from and not enough to practise against.',
        },
      ],
      review:
        'GAP. No drill in the library isolates the grip. The stance drill mentions it ' +
        'in passing and nothing rehearses it. A short grip station would be one row of ' +
        'new content and would close this properly; it is deliberately not invented ' +
        'here. Until then a coach should treat this as a teach-and-check inside stage 1 ' +
        'rather than as a stage with its own practice time.',
    },
    {
      key: 'load',
      name: 'Load',
      objective: 'Moves weight into the back hip and can hold it there, without leaning backwards.',
      whyItMatters:
        'Everything after this is a transfer of something. A hitter who never loads has ' +
        'nothing to transfer and swings with their arms.',
      masterySignals: [
        'Can hold the loaded position for two seconds without wobbling',
        'Back hip loads without the upper body leaning backwards',
        'Front shoulder stays closed while the weight moves back',
      ],
      commonFailureModes: [
        'Leaning back over the heel instead of loading into the hip',
        'Hands and hips going back together, so there is no separation left',
        'Loading and launching as one movement, with no position in between',
      ],
      coachingEmphasis: '"Weight into the back hip, not back over your heel."',
      practicesMin: 2,
      practicesMax: 4,
      problems: ['lunging', 'flying-open'],
      drills: [
        {
          drill: 'Baby Steps - Hip Load',
          role: 'primary',
          rank: 1,
          rationale:
            'Teaches the load in three stages small enough for a beginner to feel, and ' +
            'its first stage is the objective on its own — shift the weight and hold it, ' +
            'no bat movement at all.',
        },
        {
          drill: 'Catch and Crush Drill — Stay Closed',
          role: 'progression',
          rank: 1,
          rationale:
            'Once the weight can get back, this teaches what the load is FOR: hips ' +
            'starting while the shoulders stay closed. It is the load with a purpose ' +
            'attached, and it needs the load to already exist.',
        },
        {
          drill: 'Frisbee Drill — Hip Rotation & Finish',
          role: 'assessment',
          rank: 1,
          rationale:
            'The frisbee only flies to centre field if the hips led. A hitter who never ' +
            'loaded cannot make it go there, so the flight direction reads the load ' +
            'without needing a coach to judge a position.',
        },
      ],
    },
    {
      key: 'load-to-launch',
      name: 'Load to launch, and the stride',
      objective: 'Front foot lands with the hands still back, in a repeatable place, every swing.',
      whyItMatters:
        'This is the position young hitters skip straight past. If the hands go with the ' +
        'stride there is no sequence left and the swing is all arms, however good the ' +
        'load was.',
      masterySignals: [
        'Hands are still back at the moment the front foot lands',
        'Front foot lands inside the same box on eight of ten swings',
        'Stride goes toward the pitcher rather than opening out toward the dugout',
      ],
      commonFailureModes: [
        'Hands travelling forward with the stride — lunging',
        'Stride growing by six inches when the hitter tries to do more',
        'Front foot landing open, which is bailing, or closed, which is diving',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['lunging', 'stepping-in-bucket', 'flying-open', 'late-timing'],
      drills: [
        {
          drill: 'Load to Launch Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'Practises the handoff between loading and swinging as its own movement, ' +
            'with a hold at the launch position. The hold is exactly the thing this ' +
            'stage is trying to install.',
        },
        {
          drill: 'Stride Pause to Stride Swing Drill',
          role: 'regression',
          rank: 1,
          rationale:
            'Separates the stride from the swing entirely and holds it for a count. A ' +
            'hitter who cannot keep the weight back during a paused stride is not ready ' +
            'for the full handoff, and this is where to go back to.',
        },
        {
          drill: 'Stride Box',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Two lines on the ground make stride direction and length visible on every ' +
            'rep. It does not teach the sequence; it stops the stride drifting once the ' +
            'sequence is there.',
        },
      ],
    },
    {
      key: 'lower-half-sequencing',
      name: 'Lower-half sequencing',
      objective: 'Rotates around a centred axis with the hips leading, rather than sliding forward.',
      whyItMatters:
        'Bat speed at this age comes from the ground, not the arms. A hitter who drifts ' +
        'forward has converted rotation into a push and will stall out however hard they ' +
        'swing.',
      masterySignals: [
        'Head finishes roughly where it started — no drift toward the pitcher',
        'Back foot pivots on the toe rather than being dragged forward',
        'Hips lead the hands rather than opening at the same time',
      ],
      commonFailureModes: [
        'Whole body sliding toward the pitcher instead of turning',
        'Hips and shoulders opening together, so there is no torque',
        'Back side collapsing, which drops the barrel before the path starts',
      ],
      practicesMin: 2,
      practicesMax: 5,
      problems: ['flying-open', 'no-hip-lead', 'lunging'],
      drills: [
        {
          drill: 'PVC Pipe Hip Rotation Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'Rotation isolated from the swing entirely, with the pipe reporting whether ' +
            'the hitter is turning in place or swaying. It is the cheapest way to show a ' +
            'young hitter what rotating around an axis means.',
        },
        {
          drill: 'Back Knee Down - Stay Centered',
          role: 'primary',
          rank: 2,
          rationale:
            'Puts the same centred rotation into an actual swing and gives a coach a ' +
            'single thing to watch — the head staying put — which is the read this stage ' +
            'needs.',
        },
        {
          drill: 'Frisbee Drill — Hip Rotation & Finish',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'The frisbee gives immediate feedback on whether the hips led and where the ' +
            'finish pointed, with no bat and no ball to distract from it.',
        },
        {
          drill: 'Barry Larkin / Walk-Through Power Drill',
          role: 'progression',
          rank: 1,
          rationale:
            'Exaggerates the transfer so the hitter can feel what a real weight shift ' +
            'does to bat speed. It only makes sense once they can stay centred, or it ' +
            'teaches the drift this stage just removed.',
        },
        {
          drill: 'Happy Gilmore / Walking Load Drill',
          role: 'progression',
          rank: 2,
          rationale:
            'The same lesson as the walk-through from the other direction — momentum ' +
            'built behind the swing. Explicitly a feel drill, and the library says to ' +
            'tell the hitter so.',
        },
      ],
    },
    {
      key: 'bat-path',
      name: 'Bat path',
      objective: 'Hands travel to the ball ahead of the barrel, with the elbow in and no loop.',
      whyItMatters:
        'Casting and barrel dump are the two faults that make a hitter late on every ' +
        'fastball. They are path problems and cannot be fixed by swinging harder.',
      masterySignals: [
        'Back elbow stays tucked toward the ribs rather than dragging behind',
        'Barrel stays above the hands through the first part of the swing',
        'Hands travel inside the ball rather than around it',
      ],
      commonFailureModes: [
        'Barrel dumping below the hands at the start — the uppercut',
        'Hands casting away from the body, which lengthens the swing',
        'Front arm barring out, which disconnects the arms from the rotation',
      ],
      practicesMin: 3,
      practicesMax: 6,
      problems: ['casting', 'uppercutting', 'barring-arm', 'rolling-over'],
      drills: [
        {
          drill: "Don't Dump the Barrel",
          role: 'primary',
          rank: 1,
          rationale:
            'Coaches only the first six inches of the barrel\'s path, which is where the ' +
            'fault lives. The library is explicit that everything downstream of a dumped ' +
            'barrel is a symptom.',
        },
        {
          drill: 'Shoulder Swings — Stay Short to the Ball',
          role: 'primary',
          rank: 2,
          rationale:
            'Installs the elbow slot with no ball at all, which is the fastest way to ' +
            'make a short path feel like something rather than sound like an instruction.',
        },
        {
          drill: 'One-Hand Tee Drill (Bottom Hand)',
          role: 'regression',
          rank: 1,
          rationale:
            'Strips the swing to the lead arm and the knob-to-ball path. When the two- ' +
            'handed swing keeps casting, this is the half of it that is casting.',
        },
        {
          drill: 'One Hand Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Alternates both hands\' jobs in one station, and the library pairs it with ' +
            'putting both hands back on inside the same round so the feel transfers while ' +
            'it is fresh.',
        },
        {
          drill: 'Inside-Out Swing Drill (Fence Drill)',
          role: 'reinforcement',
          rank: 2,
          rationale:
            'The fence punishes casting physically and immediately. No coach judgement ' +
            'is involved, which makes it a good station to leave a group at.',
        },
        {
          drill: 'One-Hand Tee Drill (Top Hand)',
          role: 'progression',
          rank: 1,
          rationale:
            'The harder half of the one-hand family — palm-up through contact. It needs ' +
            'the bottom-hand path to already be there or it becomes an arm swing.',
        },
        {
          drill: 'Line Drive Pro / Visual Feedback Swing Drill',
          role: 'assessment',
          rank: 1,
          rationale:
            'The ball\'s flight reports the barrel angle directly — straight back means ' +
            'the path was level. It tests the stage objective without a coach having to ' +
            'see the swing.',
        },
      ],
    },
    {
      key: 'contact-point',
      name: 'Contact point',
      objective: 'Makes contact out in front of the front foot and drives the ball on a line.',
      whyItMatters:
        'Contact deep in the zone is what produces the weak ground ball to second that ' +
        'half a youth lineup hits every week. The path can be perfect and still meet the ' +
        'ball in the wrong place.',
      masterySignals: [
        'Contact happens in front of the front foot',
        'Arms are extended at contact rather than folded in',
        'Ball comes off with a sharp sound rather than a dull one',
      ],
      commonFailureModes: [
        'Meeting the ball level with the back foot and pushing it',
        'Shortening up to avoid reaching, which removes the extension',
        'Rolling the wrists early, which turns extension into a pull-side grounder',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['inconsistent-contact', 'rolling-over', 'barring-arm'],
      drills: [
        {
          drill: 'Tee Work',
          role: 'primary',
          rank: 1,
          rationale:
            'The base station, and the only one where nothing about timing can go wrong — ' +
            'which leaves the contact point as the single variable. Tee placement is the ' +
            'coaching.',
        },
        {
          drill: 'Freeze at Extension Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Holding the extended position shows both coach and hitter exactly where ' +
            'contact should be finishing. It is a position drill for the place this stage ' +
            'is about.',
        },
        {
          drill: 'Tee Work — Ball Out In Front',
          role: 'progression',
          rank: 1,
          rationale:
            'The same station with the tee moved forward so contact CAN only happen out ' +
            'in front. It makes the objective compulsory rather than coached.',
        },
      ],
    },
    {
      key: 'moving-ball-timing',
      name: 'Timing a moving ball',
      objective: 'Tracks a moving ball and drives it on a line, with the head still through contact.',
      whyItMatters:
        'Everything up to here happened against a stationary ball. This is where a swing ' +
        'either transfers or turns back into a lunge.',
      masterySignals: [
        'Ball is struck out in front of the front foot, not beside it',
        'Weight stays back until the ball is out of the feeder\'s hand',
        'Head stays down through contact rather than pulling off',
      ],
      commonFailureModes: [
        'Pulling the head off toward the field before contact',
        'Guessing off the feeder\'s arm rather than watching the ball leave the hand',
        'The stride growing because the toss was late',
      ],
      practicesMin: 3,
      practicesMax: 6,
      problems: ['late-timing', 'pulling-head', 'inconsistent-contact'],
      drills: [
        {
          drill: 'Soft Toss',
          role: 'primary',
          rank: 1,
          rationale:
            'The base station for a moving ball, at a speed a hitter can still organise ' +
            'a swing against. The library is explicit that the toss goes to the same spot ' +
            'until the swing is repeatable.',
        },
        {
          drill: 'The Track and Catch Drill — Head on the Ball',
          role: 'regression',
          rank: 1,
          rationale:
            'Removes the swing and keeps the tracking. A hitter pulling their head off ' +
            'cannot catch the ball at the contact point, so the drill diagnoses and fixes ' +
            'the same thing.',
        },
        {
          drill: 'Ripken Soft Toss Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Takes the lower half out so the hitter can only fix the swing with their ' +
            'hands. Useful here precisely because the stride is the thing that breaks ' +
            'first against a moving ball.',
        },
        {
          drill: 'Front Toss',
          role: 'progression',
          rank: 1,
          rationale:
            'The bridge between tee work and live pitching — a realistic downward plane ' +
            'at closer to game speed. It carries no progression_level in the library and ' +
            'is nonetheless the most important step in this stage.',
        },
        {
          drill: 'Drop Ball Drill',
          role: 'progression',
          rank: 2,
          rationale:
            'The shortest possible gap between the ball appearing and the swing. It ' +
            'exposes path length rather than reaction time, which is what makes it a ' +
            'timing drill rather than a reflex game.',
        },
        {
          drill: 'Mini Wiffle Ball & Skinny Bat Drill',
          role: 'assessment',
          rank: 1,
          rationale:
            'Consistent contact with a tiny ball and a narrow bat is only possible if the ' +
            'tracking and the path are both working. The library notes a real baseball ' +
            'feels effortless afterwards.',
        },
      ],
    },
    {
      key: 'pitch-location',
      name: 'Adjusting to pitch location',
      objective: 'Changes posture and path to match the height and side of the pitch.',
      whyItMatters:
        'One swing does not cover the zone. A hitter with a single path gets under the ' +
        'high pitch, stands up on the low one, and rolls over everything away.',
      masterySignals: [
        'Shoulder line flattens for high pitches and tilts for low ones',
        'Stays in the legs on the low pitch rather than standing up to reach it',
        'Drives the outside pitch to the opposite gap instead of pulling it over',
      ],
      commonFailureModes: [
        'Bending at the waist to reach a low ball instead of using the knees',
        'Swinging up at a chest-high pitch and popping it straight up',
        'Releasing the barrel early on the outside pitch, producing a weak grounder',
      ],
      practicesMin: 3,
      practicesMax: 6,
      problems: ['uppercutting', 'no-situational-hitting', 'inconsistent-contact'],
      drills: [
        {
          drill: 'High Tee',
          role: 'primary',
          rank: 1,
          rationale:
            'The direct fix for the hitter who gets under the high pitch — hands above ' +
            'the ball, barrel on the plane of the pitch rather than swinging up at it.',
        },
        {
          drill: 'Low Tee',
          role: 'primary',
          rank: 2,
          rationale:
            'The other half of the zone, and the location that produces most of the weak ' +
            'contact in youth baseball. Staying in the legs is a different skill from ' +
            'staying short, which is why both tees are here.',
        },
        {
          drill: 'PVC Posture Drill',
          role: 'regression',
          rank: 1,
          rationale:
            'Sets the posture for a called pitch height with no swing at all. When a ' +
            'hitter cannot adjust off a tee, this is where the adjustment is small enough ' +
            'to feel.',
        },
        {
          drill: 'Two-Tee Drill — Contact at Different Heights',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Forces the path to stay on one level by putting a ceiling above it. It ' +
            'trains adjustability rather than one height at a time.',
        },
        {
          drill: 'Oppo Tee & Toss — Stay Inside the Ball',
          role: 'progression',
          rank: 1,
          rationale:
            'Extends the adjustment from height to side. Rolling over the outside pitch ' +
            'is the specific failure, and the drill has a built-in reset for it.',
        },
        {
          drill: 'High Tee Drill — Hitting Up in the Zone',
          role: 'assessment',
          rank: 1,
          rationale:
            'The standard here is the shape of the batted ball — backspin line drives ' +
            'toward second — rather than contact. That is a test of the adjustment, not ' +
            'practice of it.',
        },
      ],
    },
    {
      key: 'two-strike-and-game',
      name: 'Two strikes, and the at-bat',
      objective: 'Changes approach with the count and puts the ball in play on purpose.',
      whyItMatters:
        'A swing is not an at-bat. This is the stage where hitting becomes a decision, ' +
        'and it is the first one that cannot be practised off a tee.',
      masterySignals: [
        'Chokes up and widens without being reminded once a two-strike count is called',
        'Puts the ball in play rather than swinging for power with two strikes',
        'Can state the plan before stepping in',
      ],
      commonFailureModes: [
        'The same swing in every count',
        'Chasing pitches off the plate rather than fouling them off',
        'Being early on anything slow, having only practised one speed',
      ],
      practicesMin: 3,
      practicesMax: 8,
      problems: ['two-strike-approach', 'cant-hit-offspeed', 'no-situational-hitting'],
      drills: [
        {
          drill: 'Two-Strike Hitting Adjustment Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'Teaches the physical adjustment and the mental one together — choke up, ' +
            'widen, shorten, put it in play — which is exactly this stage\'s objective.',
        },
        {
          drill: 'The Catch Drill — Track & Read Pitches',
          role: 'regression',
          rank: 1,
          rationale:
            'Removes the swing so all the attention goes to reading the pitch. A hitter ' +
            'who cannot yet tell a change from a fastball cannot make a count-based ' +
            'decision, and this is the step before trying.',
        },
        {
          drill: 'Stay Back — Beat the Changeup',
          role: 'progression',
          rank: 1,
          rationale:
            'The adjustment under genuine speed variation, with the stride still landing ' +
            'on time and the hands waiting. It is the physical half of surviving a ' +
            'pitcher with two pitches.',
        },
        {
          drill: 'Two Balls Toss Drill',
          role: 'progression',
          rank: 2,
          rationale:
            'Adds a decision to a swing the hitter already owns — pick the called ball, ' +
            'leave the other. Its own mastery signal says a take is better than a swing ' +
            'at the wrong ball, which is the approach this stage is teaching.',
        },
        {
          drill: "The Move-'Em At-Bat — Advancing Runners",
          role: 'game_application',
          rank: 1,
          rationale:
            'Live pitching, a real situation, and execution scored rather than outcome. ' +
            'It is the only drill in the library that makes the at-bat itself the unit of ' +
            'practice.',
        },
      ],
    },
  ],
}

// ── 2. INFIELD FUNDAMENTALS ─────────────────────────────────────────────────

const INFIELD_FUNDAMENTALS: PathwaySpec = {
  slug: 'infield-fundamentals',
  name: 'Infield Fundamentals',
  skillCategory: 'fielding',
  summary:
    'From a body that can get low and stay there, through the approach, the catch and ' +
    'the exchange, to a throw that beats a runner.',
  applicability:
    'Works for any infield position. Stages 1 to 6 are the same for everyone; stage 11 ' +
    'is where first base and the middle infield separate. A player who cannot yet catch ' +
    'a thrown ball should run Throwing Development stage 5 alongside this.',
  minAge: 6,
  maxAge: 14,
  provenance: PROVENANCE,
  stages: [
    {
      key: 'ready-position',
      name: 'Ready position and athletic posture',
      objective: 'Gets low with the chest over the toes and stays there between reps.',
      whyItMatters:
        'Almost every youth fielding error starts with a player standing up. Posture is ' +
        'not a detail of fielding; it is the thing that makes fielding possible.',
      masterySignals: [
        'Holds a low athletic position for three seconds without putting a foot down',
        'Stays low between reps instead of standing up and resetting',
        'Chest is over the toes rather than upright over the heels',
      ],
      commonFailureModes: [
        'Standing tall and bending only at the waist',
        'Resetting to an upright position after every ball',
        'Weight on the heels, so the first step is backwards',
      ],
      practicesMin: 1,
      practicesMax: 3,
      problems: ['fielding-flat-footed', 'poor-fielding-footwork'],
      drills: [
        {
          drill: 'The Flamingo Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'Standing on one leg makes a fake fielding position impossible — a player ' +
            'standing too tall simply falls over. The posture is the whole drill.',
        },
        {
          drill: 'Fun Fielding Drill for Young Players',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Keeps the same low position under a scoring game, which is how the posture ' +
            'survives contact with a six-year-old\'s attention span.',
        },
        {
          drill: 'Youth Infield Drill (Practice Anywhere)',
          role: 'reinforcement',
          rank: 2,
          rationale:
            'A slow rolled ball leaves time to coach the position itself rather than the ' +
            'reaction, and it needs no field.',
        },
      ],
    },
    {
      key: 'glove-presentation',
      name: 'Glove presentation and receiving',
      objective: 'Sets the glove before the ball arrives and covers with the throwing hand.',
      whyItMatters:
        'A glove that turns over during the catch is the difference between a routine ' +
        'play and a bobble, and it is invisible unless somebody looks for it.',
      masterySignals: [
        'Glove is down with the fingers pointing at the ground before the ball arrives',
        'Throwing hand covers the ball on most catches',
        'Ball is received and funnelled rather than stabbed at',
      ],
      commonFailureModes: [
        'One-handed catches on balls between the shoulders and the waist',
        'Glove turning over mid-catch because it was set late',
        'Hard hands — fighting the ball instead of receiving it',
      ],
      practicesMin: 1,
      practicesMax: 3,
      problems: ['one-hand-catching', 'fear-of-ball'],
      drills: [
        {
          drill: 'Fun Fielding Drill for Young Players',
          role: 'primary',
          rank: 1,
          rationale:
            'The alligator cue — glove down, throwing hand on top — is the version of ' +
            'this rule that lands at this age, and the drill is built around it.',
        },
        {
          drill: 'EASY Baseball Catch Drill — First Catch Fundamentals',
          role: 'regression',
          rank: 1,
          rationale:
            'Filed under Throwing, but it is the clearest statement of the receiving rule ' +
            'an infielder needs: above the belly button fingers up, below it fingers down, ' +
            'set before the ball arrives.',
        },
        {
          drill: 'The Hands Routine — Infield Fielding Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Solo wall work that progresses two hands, glove only, then backhand — high ' +
            'volume receiving reps with no partner and no field.',
        },
      ],
    },
    {
      key: 'approach',
      name: 'Approach and getting around the ball',
      objective: 'Arrives at the ball moving forward, having taken an angle rather than a straight line.',
      whyItMatters:
        'A fielder who runs straight at a ground ball has to stop to field it, and a ' +
        'fielder who stops has no throw. The angle is what buys the throw.',
      masterySignals: [
        'Rounds the outside of the cone rather than cutting inside it',
        'Fields on the move rather than stopping to set up',
        'Shuffles to get in front rather than reaching sideways with the glove',
      ],
      commonFailureModes: [
        'Taking the straight line and arriving stopped',
        'Crossing the feet instead of shuffling',
        'Standing up between reps, which loses the next one before it starts',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['poor-fielding-footwork', 'fielding-flat-footed'],
      drills: [
        {
          drill: 'The Cone Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'A cone teaches the approach angle that words do not — going around it is the ' +
            'objective made physical, and cutting inside it is the fault made visible.',
        },
        {
          drill: 'Four Cones Ground Ball Drill',
          role: 'primary',
          rank: 2,
          rationale:
            'Every ball is fielded from a different position after a different movement, ' +
            'so the approach has to be found rather than rehearsed from one spot.',
        },
        {
          drill: 'Figure Eight Infield Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'The pattern keeps the feet moving between reps, which is precisely the ' +
            'standing-up habit this stage is breaking.',
        },
        {
          drill: 'Cross-Shuffle Drill',
          role: 'progression',
          rank: 1,
          rationale:
            'Adds another player and a call to the same shuffle, so the approach has to ' +
            'survive not being the only person moving.',
        },
      ],
    },
    {
      key: 'reading-hops',
      name: 'Reading hops',
      objective: 'Adjusts to a ball that does not bounce true, and receives the short hop with a soft glove.',
      whyItMatters:
        'On a youth infield most balls take a bad hop. A fielder who can only handle the ' +
        'true bounce is a fielder who makes errors on ordinary ground balls.',
      masterySignals: [
        'Glove works through the hop rather than at it',
        'Moves to the loose ball rather than reaching for it when the hop beats them',
        'Picks short hops cleanly more often than not',
      ],
      commonFailureModes: [
        'Stabbing at the ball as it changes direction',
        'Freezing after a bad hop instead of recovering',
        'Backing up on an in-between hop rather than moving up or dropping back',
      ],
      practicesMin: 2,
      practicesMax: 5,
      problems: ['poor-fielding-footwork'],
      drills: [
        {
          drill: 'Recovery Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'Deliberately rolls balls that cannot be fielded cleanly and does not let the ' +
            'rep end at the bobble. It is the only drill in the library built around the ' +
            'ball not doing what it should.',
        },
        {
          drill: 'The Hands Routine — Infield Fielding Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Its harder stages add short hops on purpose, and an uneven wall makes the ' +
            'rebound genuinely unpredictable — hop reading with no partner needed.',
        },
        {
          drill: 'Advanced First Base — Off-Line Throws, Picks & Short Hops',
          role: 'progression',
          rank: 1,
          rationale:
            'Announced hops progressing to random is the cleanest short-hop teaching ' +
            'sequence the library has, even though it is framed for first base.',
        },
      ],
      review:
        'THIN. No drill in the library exists to teach hop reading for an infielder ' +
        'generally. The three attached each cover part of it — recovery after a bad hop, ' +
        'solo short hops off a wall, and a first-base-framed picking progression — and ' +
        'none of them is a general in-between-hop station. A drill that rolls balls at ' +
        'varied distances so the fielder has to choose to charge or drop back would close ' +
        'this; it is not invented here.',
    },
    {
      key: 'fielding-out-front',
      name: 'Fielding out in front',
      objective: 'Meets the ball in front of the front foot, with the glove visible and the eyes on it.',
      whyItMatters:
        'A ball fielded beside or under the body cannot be seen into the glove and cannot ' +
        'be transferred quickly. Out in front is what makes the next two stages possible.',
      masterySignals: [
        'Glove reaches the ball out in front of the front foot',
        'Ball is funnelled to the middle of the body, not caught out to the side',
        'Glove stays out in front rather than tucked underneath',
      ],
      commonFailureModes: [
        'Letting the ball come to the body and playing it off the chest',
        'Fielding beside the foot, where the exchange has nowhere to go',
        'Glove underneath, which hides the ball at exactly the wrong moment',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['fielding-flat-footed', 'poor-fielding-footwork'],
      drills: [
        {
          drill: 'Youth Infield Drill (Practice Anywhere)',
          role: 'primary',
          rank: 1,
          rationale:
            'Because the ball comes slowly there is time to coach the parts that get ' +
            'skipped at speed, and its first mastery signal is this stage\'s objective ' +
            'stated exactly.',
        },
        {
          drill: 'The Flamingo Drill',
          role: 'regression',
          rank: 1,
          rationale:
            'Chest over toes with the glove down in front, held still. When the glove ' +
            'keeps ending up under the body, this is the position to rebuild from.',
        },
        {
          drill: 'Four Cones Ground Ball Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Requires the glove out in front of the front foot on every catch while the ' +
            'feet are still moving, which is harder and more realistic than from a set ' +
            'position.',
        },
      ],
    },
    {
      key: 'funnel-transfer',
      name: 'Funnel and transfer',
      objective: 'Gets the ball from glove to throwing hand in one motion, in front of the chest.',
      whyItMatters:
        'The exchange is where youth infielders lose the out. It is also the part nobody ' +
        'practises, because it looks like something that happens on its own.',
      masterySignals: [
        'Ball leaves the glove and reaches throwing position in one motion',
        'Exchange happens in front of the chest, not below the waist',
        'Four-seam grip more often than not, without looking at the hand',
      ],
      commonFailureModes: [
        'Dropping the glove to the hip to make the exchange',
        'A gather step between the catch and the release',
        'Hunting for the grip after the ball is already in the hand',
      ],
      practicesMin: 2,
      practicesMax: 5,
      problems: ['slow-transfer'],
      drills: [
        {
          drill: 'Groundball Transfer Catch',
          role: 'primary',
          rank: 1,
          rationale:
            'Treats the exchange as the skill rather than an afterthought, and asks the ' +
            'player to hold the throwing position so a coach can actually see it.',
        },
        {
          drill: 'Two Hand Catch',
          role: 'regression',
          rank: 1,
          rationale:
            'Catch it, cover it, show me. The habit the transfer depends on, built where ' +
            'there is no ground ball to complicate it.',
        },
        {
          drill: 'Quick Hands Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'At twelve feet a wind-up is impossible, so the only thing that can improve ' +
            'is the exchange itself. The library says the drill coaches itself.',
        },
        {
          drill: 'Quick Hands Quick Feet — Fast Transfer Drill',
          role: 'progression',
          rank: 1,
          rationale:
            'Adds the throwing hand moving to meet the ball as the glove closes, which is ' +
            'the version of the exchange a double play needs.',
        },
      ],
    },
    {
      key: 'footwork-into-throw',
      name: 'Footwork into the throw',
      objective: 'Steps toward the target after fielding, with the body aligned before the arm works.',
      whyItMatters:
        'An infielder who throws across their body is inaccurate no matter how good the ' +
        'arm is. The feet decide where the throw goes.',
      masterySignals: [
        'Points the back-foot "ankle eye" and steps at the target',
        'Fielder steps toward the target rather than throwing across their body',
        'Exchange and throw happen without an extra shuffle to gather',
      ],
      commonFailureModes: [
        'Throwing from wherever the feet happened to land',
        'An extra gather step that costs the out',
        'Shoulders open to the target, so the throw drifts glove side',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['inaccurate-throws', 'slow-transfer'],
      drills: [
        {
          drill: 'The Ankle Eye Drill — Footwork Foundation',
          role: 'primary',
          rank: 1,
          rationale:
            'One memorable cue that fixes the commonest footwork flaw after fielding, and ' +
            'the library notes the shoulders line up automatically once the feet do.',
        },
        {
          drill: 'Point-and-Go Glove Drill — Align Your Body to the Target',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'The glove arm as the aiming device. It addresses the same alignment from the ' +
            'top half, which is the half the ankle eye does not cover.',
        },
        {
          drill: 'Infield Throwing Drill',
          role: 'assessment',
          rank: 1,
          rationale:
            'The whole play end to end, where the footwork between catch and throw is ' +
            'explicitly the thing being coached. If it holds here it has landed.',
        },
      ],
    },
    {
      key: 'throwing-accuracy',
      name: 'Throwing accuracy after fielding',
      objective: 'Delivers a catchable, chest-high throw to a target after a live ground ball.',
      whyItMatters:
        'Accuracy in a catch line and accuracy after fielding a ball are different skills. ' +
        'Only the second one records outs.',
      masterySignals: [
        'Throw arrives chest-high and catchable at the base',
        'Fields the ball cleanly before looking up for the target',
        'Accuracy holds up when the score is close',
      ],
      commonFailureModes: [
        'Looking for the target before the ball is in the glove',
        'Rushing and breaking the mechanics under a clock',
        'Throwing at the base rather than through it, so the ball dies short',
      ],
      practicesMin: 2,
      practicesMax: 5,
      problems: ['inaccurate-throws', 'slow-transfer'],
      drills: [
        {
          drill: 'Protect the Castle + Throw',
          role: 'primary',
          rank: 1,
          rationale:
            'Adds the throw to a fielding game the player already knows, and its cue is ' +
            'the order of operations this stage needs: field it, THEN find the target.',
        },
        {
          drill: 'Bullseye Challenge — Throwing Accuracy Competition',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Trains aiming at a spot rather than at a person, and its harder version ' +
            'explicitly requires a fielded ground ball first.',
        },
        {
          drill: 'Clean Up Crew — Fun Fielding-to-Throw Game',
          role: 'game_application',
          rank: 1,
          rationale:
            'Thirty fielding-to-throw reps disguised as tidying up, with the accuracy ' +
            'under real hurry rather than under instruction.',
        },
      ],
    },
    {
      key: 'range',
      name: 'Range: forehand, backhand and lateral',
      objective: 'Gets to balls either side of the body and still fields them cleanly.',
      whyItMatters:
        'A fielder who can only handle what is hit at them covers about a third of their ' +
        'position. Range is footwork plus a glove angle, and both can be taught.',
      masterySignals: [
        'Moves laterally and gets the body in front rather than reaching sideways',
        'Fields backhands with the glove out front, not beside the body',
        'Plant foot lands consistently outside the ball on a true backhand',
      ],
      commonFailureModes: [
        'Reaching across the body instead of moving the feet',
        'Turning a backhand into a stab because the glove angle is wrong',
        'Crossing the feet on lateral movement and arriving unbalanced',
      ],
      practicesMin: 2,
      practicesMax: 5,
      problems: ['poor-fielding-footwork'],
      drills: [
        {
          drill: 'Protect the Castle',
          role: 'primary',
          rank: 1,
          rationale:
            'Lateral movement with obvious stakes, and the scoring makes a six-year-old ' +
            'move their feet without being told to.',
        },
        {
          drill: 'Cross-Shuffle Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Lateral shuffling over real distance with a ball arriving in the space ' +
            'between two players, so the range has to be covered at speed.',
        },
        {
          drill: 'Daily Backhand Series',
          role: 'progression',
          rank: 1,
          rationale:
            'The only dedicated backhand work in the library — glove angle first from the ' +
            'knees, then footwork, then speed. Its own regression is the knees stage.',
        },
      ],
    },
    {
      key: 'game-speed-decisions',
      name: 'Game-speed decisions',
      objective: 'Makes the play under time pressure, including when the first attempt goes wrong.',
      whyItMatters:
        'Every stage before this assumed a clean rep. Games are mostly not clean reps, ' +
        'and the difference between an error and an out is usually what happens next.',
      masterySignals: [
        'Completes the throw on more than half the bad reps',
        'Fields the ball outside the glove-side foot on the run',
        'Stays in athletic position while waiting rather than standing up',
      ],
      commonFailureModes: [
        'Giving up on the play after a bobble',
        'Stopping to set up on a slow roller and losing the race',
        'Head dropping after a mistake, so the next ball is lost too',
      ],
      practicesMin: 3,
      practicesMax: 6,
      problems: ['poor-fielding-footwork', 'slow-transfer'],
      drills: [
        {
          drill: 'Recovery Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'The rep does not end at the bobble. Its real content is the belief that there ' +
            'is still time, which the library names as most of the drill.',
        },
        {
          drill: 'The Best Youth Infield Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Tempo is the feature — a ball every fifteen seconds per player — so the ' +
            'fielding position has to hold up without recovery time between reps.',
        },
        {
          drill: 'Three-Ball Slow Roller Drill',
          role: 'progression',
          rank: 1,
          rationale:
            'Three charges with no reset between them, which is the do-or-die play where ' +
            'stopping to set up loses the race.',
        },
      ],
    },
    {
      key: 'position-specific',
      name: 'Position-specific play',
      objective: 'Executes the plays their actual position is responsible for.',
      whyItMatters:
        'First base and the middle infield diverge here, and both sets of plays are ' +
        'learnable long before a youth team usually teaches them.',
      masterySignals: [
        'First baseman finds the bag without looking down and stretches on release',
        'Feeds arrive chest-high at the bag on a double play',
        'Pivot man\'s exchange takes one step or fewer',
      ],
      commonFailureModes: [
        'Stretching as the fielder arrives rather than as the throw is released',
        'Feeding the ball at the receiver\'s ankles, which ends the play',
        'Learning the turn with a runner already involved, so the footwork never sets',
      ],
      practicesMin: 3,
      practicesMax: 8,
      problems: ['first-base-footwork', 'slow-transfer'],
      drills: [
        {
          drill: 'First Base Fundamentals — Finding the Bag & the Stretch',
          role: 'primary',
          rank: 1,
          rationale:
            'The starting point for first base, and it rehearses the footwork with no ball ' +
            'before adding one — which is the order this stage needs.',
        },
        {
          drill: 'Double-Play Feeds & Turns',
          role: 'primary',
          rank: 2,
          rationale:
            'Builds the double play in order: feeds, then turns with no runner, then both. ' +
            'The feed is the half most youth teams never practise.',
        },
        {
          drill: 'Second Baseman Flip/Throw Combo',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'The choice between a flip and a throw, drilled back to back so the player ' +
            'learns to pick rather than to default.',
        },
        {
          drill: 'First Base Footwork & Throw Adjustments',
          role: 'progression',
          rank: 1,
          rationale:
            'Throws to all four quadrants, which at youth level is most of them. The feet ' +
            'chase the throw rather than the glove alone.',
        },
        {
          drill: 'Advanced First Base — Off-Line Throws, Picks & Short Hops',
          role: 'progression',
          rank: 2,
          rationale:
            'Short hops, then random short hops, then a live runner — the only drill that ' +
            'makes stretch timing real rather than rehearsed.',
        },
        {
          drill: 'Grounder to First, Pitcher Covers',
          role: 'game_application',
          rank: 1,
          rationale:
            'The play that needs two positions to agree. It is where first-base footwork ' +
            'stops being an individual skill.',
        },
      ],
    },
  ],
}

// ── 3. THROWING DEVELOPMENT ─────────────────────────────────────────────────

const THROWING_DEVELOPMENT: PathwaySpec = {
  slug: 'throwing-development',
  name: 'Throwing Development',
  skillCategory: 'throwing',
  summary:
    'A throw built from the hand outwards: grip, then arm action, then where the body ' +
    'points, then the legs, then doing it quickly, accurately and far.',
  applicability:
    'Everyone throws, so this pathway applies to the whole roster regardless of position. ' +
    'Throwing load is a safety constraint, not a level: a beginner may need the arm-care ' +
    'work in stages 1 and 9 more than an older player does, not less.',
  minAge: 6,
  maxAge: 14,
  provenance: PROVENANCE,
  stages: [
    {
      key: 'grip-and-release',
      name: 'Grip and a clean release',
      objective: 'Finds a four-seam grip without looking and lets the ball go without fear.',
      whyItMatters:
        'A ball gripped across the seams flies straight. A first-year player who is ' +
        'frightened of throwing badly will not throw at all, which is the real thing being ' +
        'removed here.',
      masterySignals: [
        'Four-seam grip appears without the coach asking for it',
        'Player throws willingly and repeatedly without hesitating before each one',
        'Arm finishes across the body rather than stopping at release',
      ],
      commonFailureModes: [
        'Gripping across the seams so the ball tails',
        'Hunting for the grip with the eyes before every throw',
        'Stopping the arm at release, which is usually caution rather than mechanics',
      ],
      practicesMin: 1,
      practicesMax: 3,
      problems: ['throwing-mechanics', 'no-wrist-snap'],
      drills: [
        {
          drill: 'Simple Throwing Progressions',
          role: 'primary',
          rank: 1,
          rationale:
            'Three things and no more — grip across four seams, point the glove, step and ' +
            'throw. The library explicitly warns against adding a fourth.',
        },
        {
          drill: 'Foul Line Throw — First Throw Introduction for Beginners',
          role: 'regression',
          rank: 1,
          rationale:
            'Removes the catcher entirely, so there is nothing to miss and nothing to be ' +
            'embarrassed about. For a genuine beginner this is the step before a partner.',
        },
        {
          drill: 'Baseball Arm Stretches and Pre-Throwing Warm-Up',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Attached at the first stage on purpose: the habit of warming up before ' +
            'throwing is built at the same time as the throw, or it is never built.',
        },
      ],
    },
    {
      key: 'arm-action',
      name: 'Basic arm action',
      objective: 'Takes the ball down and through with the elbow at shoulder height and a wrist snap.',
      whyItMatters:
        'The ball leaving the glove sideways is the single most common arm-path fault in ' +
        'youth baseball, and it is the root of both the dropped elbow and the sore arm.',
      masterySignals: [
        'Ball travels down toward the hip on separation rather than out to the side',
        'Elbow reaches shoulder height before the arm comes forward',
        'Ball comes out with backspin rather than wobbling or being pushed',
      ],
      commonFailureModes: [
        'Scarecrow arm — the ball swinging wide of the body',
        'Elbow dropping below the shoulder, producing a sidearm sling',
        'Pushing the ball rather than snapping it',
      ],
      practicesMin: 2,
      practicesMax: 5,
      problems: ['throwing-mechanics', 'low-arm-slot', 'short-arming', 'no-wrist-snap'],
      drills: [
        {
          drill: 'Funnel Drill — Correct Arm Path Out of the Glove',
          role: 'primary',
          rank: 1,
          rationale:
            'Directly targets the down-then-up path out of the glove, which the library ' +
            'names as the most common arm-path fault in youth throwing.',
        },
        {
          drill: 'Kneel-Down Throw — Isolating Upper Body and Wrist Snap',
          role: 'primary',
          rank: 2,
          rationale:
            'Removes the legs so the arm has nowhere to hide. It is the fastest way to see ' +
            'what the arm and wrist are actually doing.',
        },
        {
          drill: 'High Five Drill — Elbow Up Arm Path Correction',
          role: 'regression',
          rank: 1,
          rationale:
            'One cue, five minutes, and the elbow is at shoulder height. When the arm path ' +
            'is too broken to drill, this is the position to install first.',
        },
        {
          drill: 'Throwing Progression for Youth Players — Knee, Hip, Full',
          role: 'progression',
          rank: 1,
          rationale:
            'Phases the arm action into the whole throw one addition at a time, and the ' +
            'library is explicit about not letting a player skip ahead.',
        },
      ],
    },
    {
      key: 'direction',
      name: 'Direction and alignment',
      objective: 'Lines the body up at the target before the arm works.',
      whyItMatters:
        'Accuracy is mostly alignment. A player whose chest finishes facing the dugout ' +
        'cannot throw straight however good the arm action is.',
      masterySignals: [
        'Glove elbow points at the target before the arm comes through',
        'Front foot lands pointing at the partner',
        'Chest finishes facing the target rather than falling off to the side',
      ],
      commonFailureModes: [
        'Striding across the body, which sends the throw arm side',
        'No step at all, so the throw is all arm',
        'Aiming with the hand rather than pointing the body',
      ],
      practicesMin: 1,
      practicesMax: 3,
      problems: ['inaccurate-throws'],
      drills: [
        {
          drill: 'Point-and-Go Glove Drill — Align Your Body to the Target',
          role: 'primary',
          rank: 1,
          rationale:
            'The glove arm as the aiming device, which aligns hips, shoulders and chest in ' +
            'one movement a six-year-old can copy.',
        },
        {
          drill: 'The Ankle Eye Drill — Footwork Foundation',
          role: 'primary',
          rank: 2,
          rationale:
            'Alignment from the feet rather than the glove. The two together cover both ' +
            'halves of the body, which is why both are primary here.',
        },
        {
          drill: 'Simple Throwing Progressions',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Two of its three steps — point the glove, step at the target — are this ' +
            'stage, so it doubles as a low-effort refresher.',
        },
      ],
    },
    {
      key: 'lower-half',
      name: 'Lower-half involvement',
      objective: 'Uses the legs and torso so the throw is not made by the arm alone.',
      whyItMatters:
        'An arm-only throw is both weaker and harder on the elbow. This stage is where ' +
        'throwing stops being a hand skill.',
      masterySignals: [
        'Chest finishes facing the target in the wide-stance phase',
        'Full throw keeps the arm action built in the earlier phases',
        'Body is moving toward the target at release rather than stopping to throw',
      ],
      commonFailureModes: [
        'Reverting to an arm throw the moment the legs are allowed back in',
        'Throwing flat-footed with no stride',
        'Using the legs but losing the arm path that was just built',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['weak-throws', 'throwing-mechanics'],
      drills: [
        {
          drill: 'Throwing Progression for Youth Players — Knee, Hip, Full',
          role: 'primary',
          rank: 1,
          rationale:
            'The whole point of the three phases is adding the lower half one piece at a ' +
            'time, with the arm action already established. That is this stage exactly.',
        },
        {
          drill: 'Kneel-Down Throw — Isolating Upper Body and Wrist Snap',
          role: 'regression',
          rank: 1,
          rationale:
            'When the arm action falls apart as the legs come back in, this is the phase ' +
            'to return to — the same drill, one step back.',
        },
        {
          drill: 'Crow Hop — Arm Strength and Outfield Throwing',
          role: 'progression',
          rank: 1,
          rationale:
            'Converts a standing throw into a moving one and puts the whole body behind ' +
            'it. It needs the sequence to already exist or it is just a hop.',
        },
      ],
    },
    {
      key: 'catch-and-throw-rhythm',
      name: 'Catch-and-throw rhythm',
      objective: 'Catches cleanly and throws back with full mechanics, repeatedly.',
      whyItMatters:
        'Almost all real throwing happens after a catch. A player who can throw from a ' +
        'standstill and not after receiving has a skill that never appears in a game.',
      masterySignals: [
        'Throw arrives between the partner\'s shoulders and waist',
        'Steps toward the partner on every throw, even at the shortest distance',
        'Mechanics at rep twenty-five look like mechanics at rep one',
      ],
      commonFailureModes: [
        'Flicking the ball at short distance instead of using full mechanics',
        'One-handed catches, which slow every exchange that follows',
        'Warm-up catch treated as something to do while the coach sets up',
      ],
      practicesMin: 2,
      practicesMax: 6,
      problems: ['throwing-mechanics', 'one-hand-catching'],
      drills: [
        {
          drill: 'Partner Catch',
          role: 'primary',
          rank: 1,
          rationale:
            'Plain catch treated as a skill, with the full sequence on every throw and one ' +
            'coaching point per round. It is the base station of the whole pathway.',
        },
        {
          drill: 'Two Hand Catch',
          role: 'regression',
          rank: 1,
          rationale:
            'The catching half, isolated, with the one-handed catch explicitly not ' +
            'counting. The habit has to cost something to form.',
        },
        {
          drill: 'Warm-Up Catch',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'The same rhythm built into the start of every practice, which is the only way ' +
            'it gets enough reps. The library calls it the best coaching time in the ' +
            'session.',
        },
        {
          drill: 'Wall Ball',
          role: 'reinforcement',
          rank: 2,
          rationale:
            'Continuous throw-field-throw with no partner, so a player can get more reps ' +
            'alone in five minutes than in a whole catch line.',
        },
        {
          drill: 'Over-Under — Two Ways to Throw and Catch',
          role: 'progression',
          rank: 1,
          rationale:
            'Alternates overhand and flip so the receiver has to read the delivery rather ' +
            'than expect it — rhythm under a small decision.',
        },
        {
          drill: 'Wall Ball Solo Drill — Partner-Free Mechanics Builder',
          role: 'assessment',
          rank: 1,
          rationale:
            'Fifty consecutive throws with a full step and follow-through on the fiftieth ' +
            'is a genuine test that the mechanics are automatic rather than coached.',
        },
      ],
    },
    {
      key: 'footwork',
      name: 'Throwing footwork',
      objective: 'Gets the feet organised on the move so the throw can be made from anywhere.',
      whyItMatters:
        'Direction taught standing still does not survive a ball arriving at speed. The ' +
        'feet have to solve it while moving.',
      masterySignals: [
        'Hop lands on the throwing-side foot, not the front foot',
        'Body is moving toward the target at release',
        'Player picks the right delivery for the distance without being told',
      ],
      commonFailureModes: [
        'Stopping to set the feet, which costs the play',
        'Crow hopping onto the wrong foot, which kills the momentum',
        'Throwing when a flip was right, or flipping when a throw was needed',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['weak-throws', 'fielding-flat-footed'],
      drills: [
        {
          drill: 'Crow Hop — Arm Strength and Outfield Throwing',
          role: 'primary',
          rank: 1,
          rationale:
            'Hop, plant, stride, throw — the sequence that turns a standing throw into a ' +
            'moving one, with the footwork as the explicit content.',
        },
        {
          drill: 'The Ankle Eye Drill — Footwork Foundation',
          role: 'regression',
          rank: 1,
          rationale:
            'Where to point the back foot, with no movement involved. When the crow hop ' +
            'produces wild throws, the alignment underneath it is usually the problem.',
        },
        {
          drill: 'Second Baseman Flip/Throw Combo',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Two deliveries back to back so the feet have to organise differently for ' +
            'each, which is the choice a middle infielder makes several times an inning.',
        },
      ],
    },
    {
      key: 'quick-transfer',
      name: 'Quick transfer',
      objective: 'Releases without a visible pause between the catch and the throw.',
      whyItMatters:
        'At youth level the difference between safe and out is almost always the exchange ' +
        'rather than the arm.',
      masterySignals: [
        'Ball leaves the glove and is released without a visible pause',
        'Throwing hand is already moving to the glove as the ball arrives',
        'No gather step between the catch and the release',
      ],
      commonFailureModes: [
        'Exchange dropping to the belt, which adds a beat to every throw',
        'Speed built on a fumbled transfer, which is practising fumbling',
        'A gather step that feels like control and costs the out',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['slow-transfer'],
      drills: [
        {
          drill: 'Quick Hands Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'Close enough that a wind-up is impossible, so the exchange is the only ' +
            'variable left to improve.',
        },
        {
          drill: 'Quick Hands Quick Feet — Fast Transfer Drill',
          role: 'primary',
          rank: 2,
          rationale:
            'Adds the throwing hand meeting the ball as the glove closes, which is the ' +
            'mechanism rather than the outcome.',
        },
        {
          drill: 'Groundball Transfer Catch',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'The same exchange after a ground ball, which is where it actually has to ' +
            'happen.',
        },
        {
          drill: 'Selfies Solo Rebounder — Build Reps Without a Partner',
          role: 'reinforcement',
          rank: 2,
          rationale:
            'Continuous catch-and-throw with the grip reset during the catch — high ' +
            'volume, one player, one net.',
        },
      ],
    },
    {
      key: 'accuracy',
      name: 'Accuracy',
      objective: 'Throws at a specific spot and keeps doing so under mild pressure.',
      whyItMatters:
        'A player who aims at a person rather than a spot is accurate by luck. Naming the ' +
        'target is the skill.',
      masterySignals: [
        'Names or looks at a specific spot before throwing',
        'Accuracy holds up as the score gets close',
        'Mechanics stay intact under competition — the step does not disappear',
      ],
      commonFailureModes: [
        'Aiming at the whole target rather than a spot on it',
        'Rushing under pressure and losing the step',
        'Throwing harder to be more accurate, which reverses it',
      ],
      practicesMin: 2,
      practicesMax: 5,
      problems: ['inaccurate-throws', 'throwing-mechanics'],
      drills: [
        {
          drill: 'Bullseye Challenge — Throwing Accuracy Competition',
          role: 'primary',
          rank: 1,
          rationale:
            'Explicitly teaches aiming at a fist-sized spot rather than at the target, at ' +
            'a game-realistic distance.',
        },
        {
          drill: 'Fun Baseball Throwing Drill',
          role: 'regression',
          rank: 1,
          rationale:
            'The same idea sized for a player too young to enjoy repetition, with the ' +
            'distance set so roughly one throw in three scores.',
        },
        {
          drill: 'Throwing Accuracy Race — Competitive Catch Under Pressure',
          role: 'progression',
          rank: 1,
          rationale:
            'Ten in a row with a reset on any bad throw, which is what makes a player slow ' +
            'down rather than speed up as the count climbs.',
        },
        {
          drill: 'Clean Up Crew — Fun Fielding-to-Throw Game',
          role: 'game_application',
          rank: 1,
          rationale:
            'Accuracy while hurrying, disguised as a race. It tests whether the throw ' +
            'survives urgency.',
        },
      ],
    },
    {
      key: 'distance',
      name: 'Distance and long toss',
      objective: 'Builds arm strength at distance with an arc, and looks after the arm afterwards.',
      whyItMatters:
        'Distance work is how arm strength is built and is also the fastest way to hurt a ' +
        'young arm. The safety rules are part of the skill, not a footnote to it.',
      masterySignals: [
        'Throws carry with an arc at maximum distance rather than being thrown flat',
        'Completes the pulldown phase instead of finishing at maximum distance',
        'No arm soreness reported at the end or the following day',
      ],
      commonFailureModes: [
        'Driving the ball flat at maximum distance, which is reaching past the arm',
        'Skipping the pulldown, so the session ends with no accuracy left',
        'Moving back before the throws at the current distance are good',
      ],
      coachingEmphasis:
        'The arc is the safety valve. Nobody moves back until the current distance is ' +
        'comfortable.',
      practicesMin: 3,
      practicesMax: 8,
      problems: ['weak-throws', 'arm-fatigue', 'cold-arm'],
      drills: [
        {
          drill: 'Long Toss',
          role: 'primary',
          rank: 1,
          rationale:
            'The base version of the family: progressive distance with the arc as the ' +
            'limit, and no move back until the current distance is clean.',
        },
        {
          drill: 'Long Toss Progression — Building Arm Strength Safely',
          role: 'progression',
          rank: 1,
          rationale:
            'Adds the pulldown phase, which is the part most people skip and the part that ' +
            'brings accuracy back after the distance work.',
        },
        {
          drill: 'Extreme Catch — Progressive Distance Arm Builder',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'The same distance ladder as a competition, and its mastery signal is that ' +
            'players crow hop rather than throw flat as it gets long.',
        },
        {
          drill: 'Youth J-Band Routine — Pre-Throwing Activation',
          role: 'reinforcement',
          rank: 2,
          rationale:
            'Attached here because this is the stage with the highest load. Activation ' +
            'before the arm is asked for distance is the cheapest protection available.',
        },
        {
          drill: 'Post-Throwing Recovery Routine',
          role: 'reinforcement',
          rank: 3,
          rationale:
            'The fifteen minutes after the last throw. Paired with the activation routine ' +
            'it brackets the session at both ends, which is how the library describes it.',
        },
      ],
    },
    {
      key: 'game-speed',
      name: 'Game-speed throws',
      objective: 'Keeps the mechanics under real urgency, after a real play.',
      whyItMatters:
        'Everything before this was throwing. This is throwing when something depends on ' +
        'it, which is a different skill and the one that shows up on Saturday.',
      masterySignals: [
        'Throw arrives chest-high and catchable at the base under time pressure',
        'Throws still arrive on the fly when players are hurrying',
        'A dropped ball is followed by a good throw, not a rushed one',
      ],
      commonFailureModes: [
        'Rushing and breaking the mechanics, which is slower overall',
        'Decelerating into the base rather than throwing through it',
        'Aborting the play after a mistake',
      ],
      practicesMin: 2,
      practicesMax: 6,
      problems: ['inaccurate-throws', 'rushing-delivery', 'slow-transfer'],
      drills: [
        {
          drill: 'Infield Throwing Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'The whole play — field, exchange, step, throw — with the footwork between ' +
            'catch and throw as the coached part.',
        },
        {
          drill: 'Throwing Accuracy Race — Competitive Catch Under Pressure',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Mechanics under mild pressure with an immediate cost for breaking them, which ' +
            'is the mental half of a game throw.',
        },
        {
          drill: 'Do-or-Die Charge & Throw',
          role: 'progression',
          rank: 1,
          rationale:
            'The highest-urgency throw in the game, charged and released on the move. It ' +
            'is where every earlier stage either holds or does not.',
        },
      ],
    },
    {
      key: 'position-specific-throws',
      name: 'Position-specific throwing',
      objective: 'Makes the throws their position is actually asked for.',
      whyItMatters:
        'A middle infielder\'s flip, an outfielder\'s crow hop and a relay throw are ' +
        'different deliveries. Generic throwing practice never reaches any of them.',
      masterySignals: [
        'Flip arrives chest-high and firm without arcing',
        'Relay man\'s hands are up calling for the ball before it arrives',
        'Feeds arrive chest-high at the bag on a double play',
      ],
      commonFailureModes: [
        'Using one delivery for every distance',
        'Turning the wrong way on a relay and losing the line',
        'Feeding at the ankles, which ends the play',
      ],
      practicesMin: 2,
      practicesMax: 6,
      problems: ['slow-transfer', 'cutoffs-relays'],
      drills: [
        {
          drill: 'Second Baseman Flip/Throw Combo',
          role: 'primary',
          rank: 1,
          rationale:
            'The two ways a middle infielder gets rid of the ball, with fifteen feet named ' +
            'as the boundary between them.',
        },
        {
          drill: 'Line Relay Race — Catch, Turn, Throw',
          role: 'primary',
          rank: 2,
          rationale:
            'The relay delivery — big target, catch, glove-side turn, throw through the ' +
            'chest — at enough volume to become automatic.',
        },
        {
          drill: 'Double-Play Feeds & Turns',
          role: 'progression',
          rank: 1,
          rationale:
            'The feed as a throw in its own right, which is the half most youth teams ' +
            'never practise.',
        },
        {
          drill: 'Grounder to First, Pitcher Covers',
          role: 'game_application',
          rank: 1,
          rationale:
            'A throw to a moving target that has to arrive where the receiver WILL be. ' +
            'Nothing else in the library asks for that.',
        },
      ],
    },
  ],
}

// ── 4. OUTFIELD DEVELOPMENT ─────────────────────────────────────────────────

const OUTFIELD_DEVELOPMENT: PathwaySpec = {
  slug: 'outfield-development',
  name: 'Outfield Development',
  skillCategory: 'fielding',
  summary:
    'Turning a player who stands still in the outfield into one who reads the ball, gets ' +
    'to it, catches it, and throws it to the right place.',
  applicability:
    'Assumes a player who can already catch a thrown ball; if not, run stages 3 and 4 ' +
    'first and treat the rest as later work. Stages 8 to 11 need Throwing Development ' +
    'stage 6 (footwork) to have landed.',
  minAge: 7,
  maxAge: 16,
  provenance: PROVENANCE,
  stages: [
    {
      key: 'ready-and-first-step',
      name: 'Ready position and first step',
      objective: 'Is moving on contact rather than watching, with the first step taking ground.',
      whyItMatters:
        'Almost all youth outfield practice sends a ball to a stationary player. Games do ' +
        'not, and the first step is where most of the ground is won or lost.',
      masterySignals: [
        'Runs a straight line to the spot rather than drifting in a curve',
        'Glove comes up in the last two strides, not the first',
        'Is already moving when the ball is caught rather than starting from still',
      ],
      commonFailureModes: [
        'Standing flat and reacting after the ball has peaked',
        'Bringing the glove up immediately, which slows the run',
        'Drifting toward the ball instead of running to the spot and waiting',
      ],
      practicesMin: 1,
      practicesMax: 3,
      problems: ['slow-first-step', 'backpedaling-flyballs'],
      drills: [
        {
          drill: 'On the Run',
          role: 'primary',
          rank: 1,
          rationale:
            'Starts the fielder moving before the ball is in the air and never hits it ' +
            'where they are standing, which is the whole difference between this and ' +
            'ordinary fly-ball work.',
        },
        {
          drill: 'Outfield Drop Step Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Its mastery signals include the first step going back and opening the hips, ' +
            'so it doubles as first-step work before it becomes a drop-step stage.',
        },
      ],
      review:
        'THIN. There is no dedicated outfield ready-position drill in the library. "On the ' +
        'Run" covers the first step by implication because the player is already moving, ' +
        'and the drop-step drill covers it for balls hit overhead. Neither teaches the ' +
        'pre-pitch position itself. A short station — get into position on the pitch, ' +
        'react to a called direction — would close it.',
    },
    {
      key: 'drop-step',
      name: 'Drop step',
      objective: 'Opens the hips and turns to run on a ball hit overhead, rather than backpedalling.',
      whyItMatters:
        'Backpedalling is slower, less stable and caps how far back a fielder can go. It ' +
        'is the single most correctable outfield fault.',
      masterySignals: [
        'First step goes back and opens the hips rather than backpedalling',
        'Turns and runs, then locates the ball, rather than tracking it the whole way',
        'Drop steps to the weaker side look like the stronger side by the end of a session',
      ],
      commonFailureModes: [
        'Backpedalling, which loses both speed and balance',
        'Crossing over first, which turns the hips the wrong way',
        'Watching the ball the whole way and running slowly as a result',
      ],
      coachingEmphasis: '"Open the gate" is the cue that gets the hip to rotate.',
      practicesMin: 1,
      practicesMax: 3,
      problems: ['backpedaling-flyballs', 'slow-first-step'],
      drills: [
        {
          drill: 'Outfield Drop Step Drill',
          role: 'primary',
          rank: 1,
          rationale:
            'The base of its activity family and the only drill in the library dedicated ' +
            'to the first movement on a ball hit overhead.',
        },
        {
          drill: 'On the Run',
          role: 'progression',
          rank: 1,
          rationale:
            'Takes the turn into a run that has to finish with a catch, which is the drop ' +
            'step with a consequence attached.',
        },
      ],
    },
    {
      key: 'tracking',
      name: 'Tracking a ball in the air',
      objective: 'Keeps eyes on the ball into the glove and arrives set rather than still moving.',
      whyItMatters:
        'A fielder still moving when the ball arrives is the one who drops it. Tracking is ' +
        'what buys the extra half-second to be set.',
      masterySignals: [
        'Eyes stay on the ball all the way into the glove',
        'Arrives set under the ball with time to spare',
        'Catches above the head rather than trapping it at the chest',
      ],
      commonFailureModes: [
        'Head turning away in the last foot — a flinch, not a hands problem',
        'Arriving late and catching on the move when there was time to set',
        'Losing the ball against the sky and stopping rather than continuing the route',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['fear-fly-balls', 'backpedaling-flyballs'],
      drills: [
        {
          drill: 'Fly Ball Confidence Ladder',
          role: 'primary',
          rank: 1,
          rationale:
            'Distance increases only after three clean catches, so tracking is built at a ' +
            'distance the player can actually succeed at. The library names the flinch to ' +
            'watch for.',
        },
        {
          drill: 'Fly Ball Drill with Cones',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Marks where the ball will land so a young outfielder can practise the route ' +
            'before they can read it off a bat — tracking with the read scaffolded.',
        },
        {
          drill: 'On the Run',
          role: 'progression',
          rank: 1,
          rationale:
            'Tracking while already moving, which is harder and closer to what a game asks ' +
            'for.',
        },
      ],
    },
    {
      key: 'catch-confidence',
      name: 'Catch confidence',
      objective: 'Catches a ball coming down without flinching or turning away.',
      whyItMatters:
        'A player who is frightened of a fly ball will not run to one. Every later stage ' +
        'assumes they will.',
      masterySignals: [
        'Eyes stay on the ball all the way into the glove',
        'Takes a step back without being asked to',
        'Throwing hand covers the ball rather than the head turning away',
      ],
      commonFailureModes: [
        'Head turning away in the last foot before the catch',
        'Backing off the ball, which turns a catch into a chase',
        'Trapping at the chest rather than catching above the head',
      ],
      practicesMin: 1,
      practicesMax: 4,
      problems: ['fear-fly-balls', 'fear-of-ball'],
      drills: [
        {
          drill: 'Fly Ball Confidence Ladder',
          role: 'primary',
          rank: 1,
          rationale:
            'Built exactly for this: soft balls, close range, and a step back only when ' +
            'three in a row are clean. Its regression sits the fielder on a bucket so they ' +
            'cannot back away.',
        },
        {
          drill: 'Two Hand Catch',
          role: 'regression',
          rank: 1,
          rationale:
            'Removes the height entirely and builds the catch-and-cover habit at chest ' +
            'level, where there is no reason to flinch.',
        },
        {
          drill: 'EASY Baseball Catch Drill — First Catch Fundamentals',
          role: 'regression',
          rank: 2,
          rationale:
            'The glove-position rule with a soft ball from fifteen feet. For a player ' +
            'genuinely afraid of the ball this precedes anything hit in the air.',
        },
      ],
    },
    {
      key: 'angles-and-routes',
      name: 'Angles and routes',
      objective: 'Runs an efficient route to where the ball will be, not to where it is.',
      whyItMatters:
        'Speed does not fix a bad route. Two steps in the wrong direction cost more than ' +
        'most youth outfielders can make up.',
      masterySignals: [
        'Turns and runs to the spot rather than backpedalling or drifting',
        'Runs a straight line rather than a curve',
        'Arrives with time to spare rather than at full stretch',
      ],
      commonFailureModes: [
        'Drifting in an arc, which is a late read rather than a slow player',
        'Running to the ball rather than to where it is going',
        'Freezing on balls hit directly overhead',
      ],
      practicesMin: 2,
      practicesMax: 5,
      problems: ['backpedaling-flyballs'],
      drills: [
        {
          drill: 'Fly Ball Drill with Cones',
          role: 'primary',
          rank: 1,
          rationale:
            'The cone IS the route. Calling it as the ball leaves the hand means reading ' +
            'and moving rather than memorising, which the library is explicit about.',
        },
        {
          drill: 'On the Run',
          role: 'primary',
          rank: 2,
          rationale:
            'Routes run from a moving start, with the route itself — not the catch — named ' +
            'as the thing to watch.',
        },
        {
          drill: 'Outfield Drop Step Drill',
          role: 'regression',
          rank: 1,
          rationale:
            'When routes break down on balls hit back, the first movement is usually the ' +
            'cause, and this is where to rebuild it.',
        },
      ],
    },
    {
      key: 'communication',
      name: 'Communication',
      objective: 'Calls the ball early and loudly, and yields audibly when called off.',
      whyItMatters:
        'Two players who both go and neither calls is how a catchable ball lands between ' +
        'them — and how someone gets hurt.',
      masterySignals: [
        'Call comes before the ball peaks',
        'Non-catching player audibly yields and peels off',
        'No ball lands between two players across a full set',
      ],
      commonFailureModes: [
        'Calling after the peak, when there is no time left to react',
        'A silent peel-off, which looks identical to a player who has not seen it',
        'Nobody calling at all and both players pulling up',
      ],
      practicesMin: 1,
      practicesMax: 3,
      problems: ['outfield-communication'],
      drills: [
        {
          drill: 'Call It Early — Outfield Communication Basics',
          role: 'primary',
          rank: 1,
          rationale:
            'One teachable rule — before the peak, three times — with the answer made ' +
            'compulsory, which the library notes is the half most teams skip.',
        },
        {
          drill: 'Flyball Communication Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'The same call over a real gap with a hit ball, so the half-second of decision ' +
            'is genuine rather than rehearsed.',
        },
        {
          drill: 'Infield/Outfield Priority Drill',
          role: 'progression',
          rank: 1,
          rationale:
            'Extends the call to the tweener, where the rule matters most and a freeze is ' +
            'most likely. Players who can state the rule apply it in a game.',
        },
      ],
    },
    {
      key: 'ground-ball-approach',
      name: 'Ground-ball approach',
      objective: 'Fields a ball on the ground in the outfield while moving through it.',
      whyItMatters:
        'A single through the infield is an outfielder\'s ground ball, and the difference ' +
        'between a single and a double is whether they charged it.',
      masterySignals: [
        'Fields the ball outside the glove-side foot while still moving',
        'Arrives at the ball moving forward rather than stopped and waiting',
        'Chooses the block over the charge when the situation calls for it',
      ],
      commonFailureModes: [
        'Waiting for the ball and conceding a base',
        'Charging everything, including when a block was the right play',
        'Fielding the ball beside the body so there is no throw available',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['poor-fielding-footwork', 'backpedaling-flyballs'],
      drills: [
        {
          drill: 'Do-or-Die Charge & Throw',
          role: 'primary',
          rank: 1,
          rationale:
            'The only outfield ground-ball drill in the library, and it teaches the attack ' +
            'angle and the glove-side pickup explicitly. Its cues also draw the distinction ' +
            'from the routine knee-down block.',
        },
        {
          drill: 'Four Cones Ground Ball Drill',
          role: 'regression',
          rank: 1,
          rationale:
            'Filed for infielders, but what it teaches — approach angle and fielding ' +
            'through the ball moving forward — is the same movement at a slower speed. ' +
            'Useful when the charge is the part that is broken.',
        },
      ],
      review:
        'THIN. One genuine outfield ground-ball drill exists, and it is the highest-urgency ' +
        'version of the play. There is nothing for the routine single, the ball to the ' +
        'fence, or the knee-down block the library itself references. Those are three rows ' +
        'of new content; they are not invented here.',
    },
    {
      key: 'crow-hop',
      name: 'Crow hop and throwing footwork',
      objective: 'Gets the whole body behind a long throw after catching.',
      whyItMatters:
        'An outfielder throwing flat-footed loses most of their distance, and distance is ' +
        'most of what an outfield throw is for.',
      masterySignals: [
        'Hop lands on the throwing-side foot, not the front foot',
        'Body is moving toward the target at release rather than stopping to throw',
        'Throw carries noticeably further than the same player\'s flat-footed throw',
      ],
      commonFailureModes: [
        'Catching and then stopping to throw',
        'Hopping onto the wrong foot, which kills the momentum it was meant to build',
        'Throwing flat at distance instead of letting the ball carry',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['weak-throws', 'short-arming'],
      drills: [
        {
          drill: 'Crow Hop — Arm Strength and Outfield Throwing',
          role: 'primary',
          rank: 1,
          rationale:
            'Named for exactly this play and built around hop, plant, stride, throw. Its ' +
            'harder version starts the hop from a caught fly ball rather than a standstill.',
        },
        {
          drill: 'Long Toss',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'Its mastery signal is that the player uses a crow hop at the longer distances ' +
            'instead of throwing flat-footed — the same skill, under load.',
        },
        {
          drill: 'Extreme Catch — Progressive Distance Arm Builder',
          role: 'reinforcement',
          rank: 2,
          rationale:
            'A competition where the crow hop is the only way to keep stepping back, so ' +
            'the footwork is rewarded rather than instructed.',
        },
      ],
    },
    {
      key: 'throws-to-bases',
      name: 'Throws to bases and the cutoff',
      objective: 'Throws through the cutoff man to the right base.',
      whyItMatters:
        'An outfielder with a strong arm and no cutoff discipline gives up more bases than ' +
        'one with a weak arm who hits the relay.',
      masterySignals: [
        'Outfield throws come down through the cutoff man\'s head height',
        'Relay man\'s hands are up calling for the ball before it arrives',
        'Cutoff man is in line between the outfielder and the target base',
      ],
      commonFailureModes: [
        'Airmailing the cutoff man',
        'Nobody lining up, so the relay has no target',
        'Throwing to the wrong base because nobody called it',
      ],
      practicesMin: 2,
      practicesMax: 6,
      problems: ['cutoffs-relays'],
      drills: [
        {
          drill: 'Line Relay Race — Catch, Turn, Throw',
          role: 'primary',
          rank: 1,
          rationale:
            'Hands up, catch, glove-side turn, throw through the chest — the relay ' +
            'mechanics at volume, as a race so the reps happen.',
        },
        {
          drill: 'Little League Cuts & Relays System',
          role: 'primary',
          rank: 2,
          rationale:
            'The positional half: who goes where, walked through at half speed with no ' +
            'ball before anything is thrown.',
        },
        {
          drill: 'Cutoff Responsibilities by Situation',
          role: 'progression',
          rank: 1,
          rationale:
            'Turns the assignments into decisions with runners on, and the cutoff man ' +
            'making the call rather than the coach.',
        },
        {
          drill: 'Machine-Fed Relay Sequences at Game Speed',
          role: 'progression',
          rank: 2,
          rationale:
            'Full sequences at game tempo including double cuts, which is where a relay ' +
            'either holds together or does not.',
        },
      ],
    },
    {
      key: 'do-or-die',
      name: 'Do or die',
      objective: 'Charges, fields on the move and throws home with the game on the line.',
      whyItMatters:
        'This is the one outfield play that decides games, and it is a genuinely different ' +
        'play from the routine single.',
      masterySignals: [
        'Fielding happens off the glove-side foot at speed',
        'Momentum continues through the throw toward the target',
        'Throw is catchable at the plate on a line or one long hop',
      ],
      commonFailureModes: [
        'Playing it safe on a play that needed the risk',
        'Charging when the runner was never going, and turning a single into a double',
        'Fielding it cleanly and then stopping to set up, which loses the race',
      ],
      practicesMin: 2,
      practicesMax: 4,
      problems: ['backpedaling-flyballs'],
      drills: [
        {
          drill: 'Do-or-Die Charge & Throw',
          role: 'primary',
          rank: 1,
          rationale:
            'The play itself, with the distinction from the routine block taught ' +
            'explicitly and the throw timed to a plate-sized target.',
        },
        {
          drill: 'Crow Hop — Arm Strength and Outfield Throwing',
          role: 'regression',
          rank: 1,
          rationale:
            'When the throw is the part failing rather than the charge, this is the ' +
            'footwork underneath it, practised without the time pressure.',
        },
      ],
    },
    {
      key: 'decisions-under-pressure',
      name: 'Decision-making under pressure',
      objective: 'Picks the right base, the right call and the right risk, without being told.',
      whyItMatters:
        'Every skill in this pathway becomes a choice in a game. A player who can execute ' +
        'and cannot decide still gives up the base.',
      masterySignals: [
        'Correct base chosen on 4 of 5 situational reps',
        'Cutoff man makes a loud call on every ball',
        'Outfielder\'s call overrides the infielder every time',
      ],
      commonFailureModes: [
        'Waiting for a coach to call it',
        'Making the exciting throw rather than the right one',
        'Freezing on the tweener because nobody owns it',
      ],
      practicesMin: 2,
      practicesMax: 6,
      problems: ['cutoffs-relays', 'outfield-communication'],
      drills: [
        {
          drill: 'Cutoff Responsibilities by Situation',
          role: 'primary',
          rank: 1,
          rationale:
            'Assignments practised as decisions with real runners, and the cutoff man ' +
            'calling cut two, cut three or let it go himself.',
        },
        {
          drill: 'Infield/Outfield Priority Drill',
          role: 'reinforcement',
          rank: 1,
          rationale:
            'The freeze-and-ask is the teaching. A player who can state the priority rule ' +
            'applies it in a game; one who has only been shouted at does not.',
        },
        {
          drill: 'Machine-Fed Relay Sequences at Game Speed',
          role: 'game_application',
          rank: 1,
          rationale:
            'Adds runners so the throw destination is a real decision at a tempo that ' +
            'leaves no time to ask.',
        },
      ],
    },
  ],
}

export const PATHWAYS: PathwaySpec[] = [
  BUILD_THE_SWING,
  INFIELD_FUNDAMENTALS,
  THROWING_DEVELOPMENT,
  OUTFIELD_DEVELOPMENT,
]

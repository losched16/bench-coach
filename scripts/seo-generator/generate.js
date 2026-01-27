/**
 * SEO Page Generator for BenchCoach
 * 
 * Generates SEO content pages using Claude API with existing pages as style examples.
 * 
 * Usage:
 *   node generate.js                    # Generate all pages
 *   node generate.js --hub              # Generate only hub pages
 *   node generate.js --spoke            # Generate only spoke pages  
 *   node generate.js --slug 10u-hitting-drills  # Generate specific page
 *   node generate.js --dry-run          # Preview without API calls
 */

const Anthropic = require("@anthropic-ai/sdk").default;
const fs = require("fs");
const path = require("path");

// Load topics
const topics = require("./topics.json");

// Example pages for style reference (your approved content)
const STYLE_EXAMPLES = {
  hub: `
## Example Hub Page Style (8U Baseball Coaching Guide)

INTRO STYLE:
"I didn't get into coaching 8U baseball because I thought I had all the answers. I got into it because my son Charlie wanted to play, the league needed help, and I've spent most of my life either playing or coaching baseball..."

SECTION STYLE:
- Use "What Makes X Different" as opener
- Include "Mistakes I Made" section with personal stories
- "What Actually Works" with specific, actionable advice
- Real stories from the field
- Coaching cues in short, memorable phrases
- Natural BenchCoach mentions (not forced)

TONE:
- Conversational, like talking to another coach
- Self-deprecating humor welcome
- Specific examples over generic advice
- "Here's what I learned the hard way"
- Honest about challenges
`,

  spoke: `
## Example Spoke Page Style (8U Hitting Drills)

INTRO STYLE:
"When I first started coaching 8U, I thought I needed better drills. What I actually needed was simpler drills, faster reps, and fewer words..."

DRILL FORMAT:
- **Setup:** Brief description
- **How it works:** Step by step
- **Why it works:** The insight
- Coaching cue at the end

SECTION STYLE:
- Group related drills together
- Include "Common Issues and Fixes" section
- "Stories From the Field" with real examples
- End with quick reference summary

TONE:
- Practical over theoretical
- "This drill fixed X problem instantly"
- Specific coaching cues that work
- Acknowledge what doesn't work
`,
};

// System prompt for generation
const SYSTEM_PROMPT = `You are writing SEO content for BenchCoach, a youth baseball coaching app. 

VOICE: You are Clint Losch, a youth baseball coach who:
- Coaches his son's 8U rec team (don't use son's name - just say "my son")
- Played college baseball
- Coached high school baseball
- Worked as an instructor at a baseball academy
- Has run camps and clinics for various age groups
- Built BenchCoach to solve his own coaching problems
- Values practical advice over theory
- Uses humor and self-deprecation
- Admits mistakes openly

IMPORTANT - AGE GROUP CONTEXT:
- For 6U, 7U, 8U content: You can reference "my son" and "my son's team" - this is your current experience
- For 10U and older: Reference your coaching experience, camps, instruction work, or high school coaching - NOT "my son" (he's only 8)
- Never use your son's actual name - just say "my son" or "my kid"

RULES:
1. Write in first person ("I", "my team", "what I learned")
2. Include specific stories and examples
3. Use short coaching cues (5 words or less)
4. Mention BenchCoach naturally 1-2 times (not forced)
5. Include real problems you've seen on the field
6. Be honest about what doesn't work
7. Keep paragraphs short and scannable
8. Use conversational transitions

FORMATTING:
- Section headings should be practical, not clever
- Use <p> tags for paragraphs in body content
- Use <strong> for emphasis
- Include coaching_cues array for actionable tips
- Include common_mistakes array where relevant
- Add a cta object for BenchCoach features when natural

DO NOT:
- Use corporate speak
- Be generic or vague
- Over-promise results
- Sound like a textbook
- Force BenchCoach mentions
- Reference "my son" for 10U+ content`;

async function generatePage(topic, type) {
  const client = new Anthropic();

  const styleExample = STYLE_EXAMPLES[type];

  const prompt = `Generate an SEO page for BenchCoach.

PAGE DETAILS:
- Slug: ${topic.slug}
- Title: ${topic.title}
- Category: ${topic.category}
- Type: ${type}
- Age Group: ${topic.age_group || "All ages"}
- Primary Keyword: ${topic.primary_keyword}
- Meta Description: ${topic.meta_description}
${topic.hub_slug ? `- Hub Page: ${topic.hub_slug}` : ""}

EXPERIENCE CONTEXT:
${topic.age_group && ["6U", "7U", "8U"].includes(topic.age_group) 
  ? "You currently coach your son's 8U team. You can reference 'my son' and 'my son's team' for personal stories."
  : "Draw from your experience coaching high school, running camps, and working as an instructor. Do NOT reference 'my son' - he's only 8 and hasn't played at this level yet."}

TOPICS TO COVER:
${topic.topics_to_cover.map((t) => `- ${t}`).join("\n")}

${styleExample}

OUTPUT FORMAT:
Return a JSON object with this exact structure:
{
  "intro": "Opening paragraph(s) - conversational, personal, sets up the problem",
  "sections": [
    {
      "heading": "Section Title",
      "body": "<p>HTML content with <strong>emphasis</strong> where needed.</p><p>Multiple paragraphs allowed.</p>",
      "list_items": ["Optional bullet points"],
      "coaching_cues": ["Short actionable cues"],
      "common_mistakes": ["Things to avoid"],
      "cta": {
        "title": "Optional CTA title",
        "body": "CTA description",
        "link_text": "Button text",
        "link_url": "/auth/signup"
      }
    }
  ],
  "faqs": [
    {
      "question": "Common question about this topic?",
      "answer": "Helpful answer in conversational tone."
    }
  ]
}

IMPORTANT:
- Include 6-10 sections depending on topic depth
- Include 4-6 FAQs
- Make intro 2-3 paragraphs
- Only include cta in 1 section max
- coaching_cues and common_mistakes are optional per section
- Return ONLY valid JSON, no markdown code blocks`;

  console.log(`Generating: ${topic.slug}...`);

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    system: SYSTEM_PROMPT,
  });

  const content = response.content[0].text;

  // Parse JSON from response
  try {
    // Try to extract JSON if wrapped in code blocks
    let jsonStr = content;
    if (content.includes("```")) {
      jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "");
    }
    return JSON.parse(jsonStr.trim());
  } catch (e) {
    console.error(`Failed to parse JSON for ${topic.slug}:`, e.message);
    console.error("Raw response:", content.substring(0, 500));
    return null;
  }
}

function generateSQL(topic, content, type) {
  if (!content) return null;

  const escapedContent = JSON.stringify(content)
    .replace(/'/g, "''")
    .slice(1, -1); // Remove outer quotes

  const escapedFaqs = JSON.stringify(content.faqs || []).replace(/'/g, "''");

  // Build the content JSON structure
  const contentObj = {
    intro: content.intro,
    sections: content.sections,
  };

  const sql = `
-- ${topic.title}
INSERT INTO seo_pages (
  slug,
  category,
  type,
  title,
  meta_description,
  age_group,
  topic,
  primary_keyword,
  ${type === "spoke" ? "hub_slug," : ""}
  content,
  related_slugs,
  schema_faq,
  priority,
  is_published
) VALUES (
  '${topic.slug}',
  '${topic.category}',
  '${type}',
  '${topic.title.replace(/'/g, "''")}',
  '${topic.meta_description.replace(/'/g, "''")}',
  ${topic.age_group ? `'${topic.age_group}'` : "NULL"},
  '${topic.topic || topic.primary_keyword.replace(/'/g, "''")}',
  '${topic.primary_keyword.replace(/'/g, "''")}',
  ${type === "spoke" ? `'${topic.hub_slug}',` : ""}
  '${JSON.stringify(contentObj).replace(/'/g, "''")}',
  ARRAY[]::text[],
  '${escapedFaqs}',
  ${type === "hub" ? 100 : 90},
  true
) ON CONFLICT (slug) DO UPDATE SET
  content = EXCLUDED.content,
  schema_faq = EXCLUDED.schema_faq,
  updated_at = now();
`;

  return sql;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const hubOnly = args.includes("--hub");
  const spokeOnly = args.includes("--spoke");
  const slugIndex = args.indexOf("--slug");
  const specificSlug = slugIndex !== -1 ? args[slugIndex + 1] : null;

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY && !dryRun) {
    console.error("Error: ANTHROPIC_API_KEY environment variable not set");
    console.error("Set it with: export ANTHROPIC_API_KEY=your-key-here");
    process.exit(1);
  }

  let allSQL = `-- Generated SEO Pages for BenchCoach
-- Generated at: ${new Date().toISOString()}
-- Run this in Supabase SQL Editor

`;

  // Determine which pages to generate
  let pagesToGenerate = [];

  if (specificSlug) {
    // Find specific page
    const hub = topics.hubs.find((h) => h.slug === specificSlug);
    const spoke = topics.spokes.find((s) => s.slug === specificSlug);
    if (hub) pagesToGenerate.push({ ...hub, _type: "hub" });
    else if (spoke) pagesToGenerate.push({ ...spoke, _type: "spoke" });
    else {
      console.error(`Slug not found: ${specificSlug}`);
      process.exit(1);
    }
  } else {
    if (!spokeOnly) {
      pagesToGenerate.push(...topics.hubs.map((h) => ({ ...h, _type: "hub" })));
    }
    if (!hubOnly) {
      pagesToGenerate.push(
        ...topics.spokes.map((s) => ({ ...s, _type: "spoke" }))
      );
    }
  }

  console.log(`\nGenerating ${pagesToGenerate.length} pages...\n`);

  if (dryRun) {
    console.log("DRY RUN - Pages that would be generated:");
    pagesToGenerate.forEach((p) => console.log(`  - ${p.slug} (${p._type})`));
    return;
  }

  // Generate pages with rate limiting
  for (let i = 0; i < pagesToGenerate.length; i++) {
    const page = pagesToGenerate[i];
    const type = page._type;

    try {
      const content = await generatePage(page, type);
      if (content) {
        const sql = generateSQL(page, content, type);
        if (sql) {
          allSQL += sql + "\n";
          console.log(`✓ Generated: ${page.slug}`);
        }
      }

      // Rate limiting - wait 1 second between requests
      if (i < pagesToGenerate.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`✗ Failed: ${page.slug} - ${error.message}`);
    }
  }

  // Write output
  const outputPath = path.join(__dirname, "output.sql");
  fs.writeFileSync(outputPath, allSQL);
  console.log(`\n✓ SQL written to: ${outputPath}`);
  console.log(`  Total pages: ${pagesToGenerate.length}`);
}

main().catch(console.error);

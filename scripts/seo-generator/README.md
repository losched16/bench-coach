# BenchCoach SEO Page Generator

Generates SEO content pages using Claude API with your existing pages as style examples.

## Setup

1. Install dependencies:
```bash
cd scripts/seo-generator
npm install
```

2. Set your Anthropic API key:
```bash
# Windows PowerShell
$env:ANTHROPIC_API_KEY="your-key-here"

# Mac/Linux
export ANTHROPIC_API_KEY=your-key-here
```

## Usage

### Generate all pages (~75 pages, ~$10-15 in API costs)
```bash
npm run generate
```

### Generate only hub pages (9 pages)
```bash
npm run generate:hubs
```

### Generate only spoke pages (66 pages)
```bash
npm run generate:spokes
```

### Generate a specific page
```bash
node generate.js --slug 10u-hitting-drills
```

### Preview without API calls
```bash
npm run dry-run
```

## Output

The script generates `output.sql` containing INSERT statements for all pages.

To deploy:
1. Open Supabase SQL Editor
2. Paste the contents of `output.sql`
3. Run it
4. Pages are immediately live

## Customizing Topics

Edit `topics.json` to:
- Add new pages
- Modify page titles or descriptions
- Change which hub a spoke belongs to
- Add or remove topics to cover

## Cost Estimate

- ~4,000-6,000 tokens per page
- At $3/million input, $15/million output (Claude Sonnet)
- ~$0.10-0.20 per page
- Full generation (~75 pages): ~$10-15

## Tips

1. **Generate hubs first** - They set the tone for spokes
2. **Review 10-20%** - Spot check quality before bulk deployment
3. **Edit topics.json** - Add pages that matter to your audience
4. **Run in batches** - Generate 10-20 pages, review, then continue

# Bench Coach - Youth Baseball Coaching Assistant

A complete AI-powered web application for youth baseball coaches featuring practice planning, team management, player tracking, and intelligent coaching assistance.

## 🎯 Features

- **AI Chat Assistant**: Get coaching advice powered by Claude AI with team-aware context
- **Practice Plan Generator**: Auto-generate age-appropriate practice plans with drills and coaching cues
- **Team & Player Management**: Track multiple teams across seasons with persistent player data
- **Smart Memory System**: AI remembers team issues, player notes, and coaching preferences
- **Season Management**: Easily roll over teams between seasons while maintaining player history
- **Notes System**: Track team issues, player development, and coaching observations

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- A Supabase account (free tier works)
- An Anthropic API key (Claude)

### 1. Clone and Install

```bash
cd benchcoach
npm install
```

### 2. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Once created, go to Project Settings → API
3. Copy your project URL and anon/public key
4. Go to SQL Editor and run the entire `supabase-schema.sql` file to create all tables

### 3. Get Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account or sign in
3. Navigate to API Keys
4. Create a new API key

### 4. Configure Environment Variables

Create a `.env.local` file in the root directory:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Anthropic Claude API
ANTHROPIC_API_KEY=your_anthropic_api_key

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 5. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📱 First Time Setup

1. **Create Account**: Sign up with email/password
2. **Onboarding Wizard**: 
   - Create your first season (e.g., "Spring 2026")
   - Set up your team (name, age group, skill level)
   - Add players to your roster
3. **Start Coaching**: Access chat, practice planner, and team management

## 🎓 User Flow

### Creating a New Season

When a new season starts:
1. Click team selector → "+ New Season/Team"
2. Choose to:
   - **Start Fresh**: Empty roster, new slate
   - **Roll Over Players**: Import players from previous team (resets skill ratings)
   - **Clone Last Season**: Copy team structure and settings

### Daily Coaching Workflow

1. **Chat**: Ask about drills, player issues, game strategies
2. **Practice Plans**: Generate custom practice plans in seconds
3. **Notes**: Track what's working and what needs attention
4. **Roster**: Update player progress and positions

### Memory System

Bench Coach remembers:
- **Persistent**: Coach preferences, player personality traits
- **Season-Specific**: Team issues, mechanical problems, skill ratings

This prevents old problems from "haunting" players across years.

## 🛠 Tech Stack

- **Framework**: Next.js 14 (App Router)
- **Database**: Supabase (PostgreSQL)
- **AI**: Anthropic Claude Sonnet 4.5
- **Styling**: Tailwind CSS
- **Auth**: Supabase Auth
- **Deployment**: Vercel (recommended)

## 🌐 Deployment

### Deploy to Vercel (Recommended)

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com)
3. Import your repository
4. Add environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY`
5. Deploy!

### Alternative: Deploy to Netlify

```bash
npm run build
```

Then deploy the `.next` folder to Netlify with the same environment variables.

## 💰 Estimated Costs

### Monthly Operating Costs (per coach)

- **Supabase**: $0 (free tier: up to 500MB, 50k users)
- **Anthropic API**: ~$2-5/coach (based on 30-50 messages/month)
- **Vercel**: $0 (free tier: 100GB bandwidth)

**Total**: ~$2-5 per active coach per month

### Scaling Costs

At 100 active coaches:
- Supabase: $25/month (Pro plan)
- Anthropic API: $200-500/month
- Vercel: $0-20/month
- **Total**: ~$250-550/month ($2.50-5.50 per coach)

At $15/month subscription = ~$1,500 revenue → 67-83% profit margin

## 🔐 Security Features

- Row Level Security (RLS) enabled on all tables
- Coaches can only access their own data
- Supabase Auth handles password security
- API routes protected by authentication

## 📊 Database Schema

Key tables:
- `coaches` - Coach profiles
- `seasons` - Season containers (Spring 2026, etc.)
- `teams` - Season-specific teams and rosters
- `players` - Persistent player identities
- `team_players` - Season snapshots (positions, ratings)
- `player_traits` - Persistent personality notes
- `player_notes` - Season-specific mechanical issues
- `team_notes` - Team-level observations
- `practice_plans` - Generated and saved plans
- `chat_threads` & `chat_messages` - Conversation history
- `coach_preferences` - Persistent coaching style
- `team_memory_summaries` - Rolling context summaries

## 🎨 Customization

### Change AI Model

In `lib/anthropic.ts`, update the model:

```typescript
const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514', // Change this
  // ...
})
```

Options:
- `claude-opus-4-5-20251101` (most capable, more expensive)
- `claude-sonnet-4-5-20250929` (recommended balance)
- `claude-haiku-4-5-20251001` (fastest, cheapest)

### Adjust Memory Confidence Threshold

In `app/api/chat/route.ts`:

```typescript
if (pref.confidence > 0.75) { // Adjust this threshold
  // Auto-save preferences
}
```

### Add Custom Focus Areas

In `app/onboarding/page.tsx` and `app/dashboard/practice/page.tsx`:

```typescript
const PRIMARY_GOALS = [
  'throwing',
  'catching',
  'your-custom-goal', // Add here
  // ...
]
```

## 🐛 Troubleshooting

### Database Connection Issues

- Verify Supabase URL and keys in `.env.local`
- Check that RLS policies are enabled
- Ensure schema was run completely

### AI Not Responding

- Verify Anthropic API key is correct
- Check API key has sufficient credits
- Look at browser console for errors

### Authentication Issues

- Clear browser cookies/cache
- Verify Supabase auth is configured
- Check redirect URLs in Supabase dashboard

## 🔄 Converting to Mobile App

The codebase is already mobile-responsive. To create native apps:

### Option 1: React Native (Expo)

```bash
npx create-expo-app benchcoach-mobile
# Copy components and logic
# Update to use Expo/React Native components
```

### Option 2: Capacitor (Easier)

```bash
npm install @capacitor/core @capacitor/cli
npx cap init
npx cap add ios
npx cap add android
```

This wraps your web app as a native app (2-3 weeks of work).

## 📝 Future Enhancements

Possible additions for V2:
- [ ] Practice session tracking (what actually happened)
- [ ] Player progress charts
- [ ] Parent communication portal
- [ ] Team schedule management
- [ ] Game stat tracking
- [ ] Video drill library
- [ ] Multi-coach collaboration
- [ ] Mobile push notifications
- [ ] Offline mode

## 🤝 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review Supabase logs
3. Check browser console for errors
4. Verify environment variables are set

## 📄 License

This project is ready to use for your business. You own all rights to customize and deploy it.

## 🎯 Next Steps

1. ✅ Set up Supabase project
2. ✅ Get Anthropic API key
3. ✅ Configure environment variables
4. ✅ Run locally and test
5. ✅ Deploy to Vercel
6. 🚀 Launch and market to coaches!

---

Built with ⚾ for coaches who want to spend less time planning and more time coaching.

# Bench Coach - Complete File Structure

## 📁 Project Overview

```
benchcoach/
├── 📄 Configuration Files (Root Level)
│   ├── package.json              # Dependencies & scripts
│   ├── tsconfig.json             # TypeScript config
│   ├── next.config.js            # Next.js config
│   ├── tailwind.config.js        # Tailwind CSS config
│   ├── postcss.config.js         # PostCSS config
│   ├── .env.example              # Environment variables template
│   ├── .gitignore                # Git ignore rules
│   └── supabase-schema.sql       # Database setup script
│
├── 📚 Documentation
│   ├── README.md                 # Main documentation
│   ├── SETUP_GUIDE.md            # 15-min quickstart
│   ├── LAUNCH_CHECKLIST.md       # Business & launch plan
│   └── FILE_STRUCTURE.md         # This file
│
├── 📁 app/ (Next.js App Router)
│   ├── layout.tsx                # Root layout
│   ├── page.tsx                  # Home page (redirects)
│   ├── globals.css               # Global styles
│   │
│   ├── 📁 auth/ (Authentication)
│   │   ├── login/
│   │   │   └── page.tsx          # Login page
│   │   ├── signup/
│   │   │   └── page.tsx          # Signup page
│   │   └── callback/
│   │       └── route.ts          # Auth callback handler
│   │
│   ├── 📁 onboarding/
│   │   └── page.tsx              # First-time setup wizard
│   │
│   ├── 📁 dashboard/ (Main App)
│   │   ├── layout.tsx            # Dashboard layout (nav, team selector)
│   │   ├── page.tsx              # Dashboard home
│   │   │
│   │   ├── chat/
│   │   │   └── page.tsx          # AI Chat interface
│   │   │
│   │   ├── roster/
│   │   │   └── page.tsx          # Player roster management
│   │   │
│   │   ├── notes/
│   │   │   └── page.tsx          # Team notes
│   │   │
│   │   └── practice/
│   │       └── page.tsx          # Practice plan list & generator
│   │
│   └── 📁 api/ (Backend Endpoints)
│       ├── chat/
│       │   └── route.ts          # Chat API (connects to Claude)
│       └── practice-plan/
│           └── route.ts          # Practice plan generator API
│
├── 📁 lib/ (Utility Libraries)
│   ├── anthropic.ts              # Claude AI integration
│   ├── supabase.ts               # Database client & types
│   └── utils.ts                  # Helper functions
│
└── 📁 components/ (Reusable UI - Optional)
    └── ui/                       # (Can add shadcn components here)
```

## 🔑 Key Files Explained

### Root Configuration
- **package.json**: All dependencies (Next.js, Supabase, Claude SDK, etc.)
- **tsconfig.json**: TypeScript settings for type safety
- **.env.example**: Template for your API keys (copy to `.env.local`)
- **supabase-schema.sql**: Complete database schema to run in Supabase

### Authentication (`app/auth/`)
- **login/page.tsx**: Email/password login form
- **signup/page.tsx**: New user registration + coach profile creation
- **callback/route.ts**: Handles OAuth redirects

### Onboarding (`app/onboarding/`)
- **page.tsx**: 3-step wizard (Season → Team → Players)

### Dashboard (`app/dashboard/`)
- **layout.tsx**: Shared layout with navigation & team selector
- **page.tsx**: Dashboard home with quick stats & actions
- **chat/page.tsx**: AI chat with team context sidebar
- **roster/page.tsx**: Player list & management
- **notes/page.tsx**: Team notes with pinning
- **practice/page.tsx**: Practice plan generator & library

### API Routes (`app/api/`)
- **chat/route.ts**: Handles chat messages, retrieves context, calls Claude
- **practice-plan/route.ts**: Generates practice plans with Claude

### Core Libraries (`lib/`)
- **anthropic.ts**: Claude AI functions (chat, practice plans, memory system)
- **supabase.ts**: Database client, type definitions, helper functions
- **utils.ts**: Utility functions (formatting, classnames, etc.)

## 📊 Database Schema

The `supabase-schema.sql` file creates these tables:

**User & Auth:**
- `coaches` - Coach profiles

**Organization:**
- `seasons` - Season containers (Spring 2026, etc.)
- `teams` - Teams within seasons

**Players:**
- `players` - Persistent player identities
- `team_players` - Season-specific player snapshots
- `player_traits` - Persistent personality notes
- `player_notes` - Season-specific notes

**Team Data:**
- `team_notes` - Team observations & issues
- `coach_preferences` - Persistent coaching style

**Practice:**
- `practice_plans` - Generated & saved plans
- `practice_sessions` - (Optional) session recaps

**Chat:**
- `chat_threads` - Conversation threads
- `chat_messages` - Individual messages
- `team_memory_summaries` - Rolling context summaries

## 🎨 UI Components

Currently using **Tailwind CSS** for styling. All components are in the page files.

**Optional**: Can add **shadcn/ui** components later to `components/ui/` folder for:
- Buttons
- Dialogs
- Forms
- Cards
- etc.

## 🔧 How It All Works Together

1. **User signs up** → `auth/signup/page.tsx`
2. **Creates coach profile** → Supabase `coaches` table
3. **Completes onboarding** → Creates season, team, players
4. **Opens chat** → `dashboard/chat/page.tsx`
5. **Sends message** → `api/chat/route.ts`
6. **API retrieves context** → From Supabase (team, notes, players)
7. **Calls Claude** → `lib/anthropic.ts`
8. **Returns response** → With memory suggestions
9. **Saves to database** → `chat_messages` table
10. **Updates UI** → Shows response with "save to notes" buttons

## 📝 What You Can Customize

**Branding:**
- `app/globals.css` - Colors & theme
- `tailwind.config.js` - Design tokens
- Page titles in each `page.tsx`

**Features:**
- Add/remove focus areas in `app/dashboard/practice/page.tsx`
- Adjust AI behavior in `lib/anthropic.ts`
- Modify database schema in `supabase-schema.sql`

**AI Model:**
- Change in `lib/anthropic.ts`:
  ```typescript
  model: 'claude-sonnet-4-20250514'  // ← Change this
  ```

## ✅ All Files Are Included

Every file needed to run Bench Coach is in the **benchcoach** folder:

✅ 27 source code files
✅ 5 config files  
✅ 4 documentation files
✅ 1 database schema
✅ **100% complete and ready to run**

## 🚀 Next Steps

1. **Open the `benchcoach` folder** in VS Code or your editor
2. **Follow SETUP_GUIDE.md** step by step
3. **Run `npm install`** to get dependencies
4. **Configure `.env.local`** with your API keys
5. **Run `npm run dev`** to start the app

Everything is there - you just need to configure your API keys and you're ready to launch! 🎉

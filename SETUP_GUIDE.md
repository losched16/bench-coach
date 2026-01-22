# Bench Coach - 15 Minute Setup Guide

Get Bench Coach running in 15 minutes. Follow these steps in order.

## ☑️ Step 1: Supabase Setup (5 minutes)

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Fill in:
   - Name: `benchcoach`
   - Database Password: (generate strong password)
   - Region: (choose closest to you)
4. Wait 2 minutes for project creation
5. Once ready, click "SQL Editor" (left sidebar)
6. Click "New Query"
7. Copy ALL contents from `supabase-schema.sql` and paste
8. Click "Run"
9. Go to "Project Settings" → "API"
10. Copy these values:
    - **Project URL**: `https://xxx.supabase.co`
    - **anon/public key**: `eyJhbGc...` (long string)

✅ Supabase is ready!

## ☑️ Step 2: Anthropic API Key (2 minutes)

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign up or log in
3. Go to "API Keys" in the menu
4. Click "Create Key"
5. Name it "Bench Coach"
6. Copy the key (starts with `sk-ant-...`)

✅ You now have your API key!

## ☑️ Step 3: Local Setup (3 minutes)

1. Open Terminal/Command Prompt
2. Navigate to the benchcoach folder:
   ```bash
   cd path/to/benchcoach
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Create `.env.local` file in the benchcoach folder:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key_here
   ANTHROPIC_API_KEY=your_anthropic_key_here
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

5. Replace the placeholder values with your actual keys from steps 1 & 2

✅ Configuration complete!

## ☑️ Step 4: Run Locally (1 minute)

```bash
npm run dev
```

Open browser to: `http://localhost:3000`

You should see the Bench Coach login page!

✅ App is running!

## ☑️ Step 5: Test It (4 minutes)

1. Click "Sign up"
2. Create account:
   - Name: Your name
   - Email: your@email.com
   - Password: (make it strong)
3. Click "Create Account"
4. Complete onboarding:
   - Season: "Spring 2026"
   - Team: "8U Tigers" (or your team name)
   - Age: 8U
   - Add 2-3 test players
5. Click "Complete Setup"

You're now in the dashboard!

Try these:
- Click "Open Chat" → Ask: "What should we work on at practice?"
- Click "Plan Practice" → Generate a practice plan
- Click "Roster" → See your players

✅ Bench Coach is working!

## 🚀 Deploy to Production (Optional - 5 minutes)

### Deploy to Vercel:

1. Push code to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin your-github-repo-url
   git push -u origin main
   ```

2. Go to [vercel.com](https://vercel.com)
3. Click "Import Project"
4. Select your GitHub repo
5. Add environment variables (same as .env.local but update the URL):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY`
   - `NEXT_PUBLIC_APP_URL` = your-app-name.vercel.app
6. Click "Deploy"
7. Wait 2 minutes

✅ Bench Coach is live!

## 🎯 What's Next?

### Customize:
- Update team name in dashboard
- Add your actual roster
- Start using chat for real coaching questions
- Generate practice plans for this week

### Share:
- Send link to other coaches
- Each coach creates their own account
- All data is private and secure

### Monetize (if you want):
- Add Stripe for payments
- Set pricing: $9-15/month
- Market to local leagues

## 💡 Tips

**Cost**: With Claude API, expect ~$2-5 per active coach per month. At $15/month subscription, that's great margins.

**Speed**: The AI responses are usually 2-3 seconds. Practice plan generation takes 5-10 seconds.

**Data**: Everything is private. Coaches only see their own data.

## ❓ Troubleshooting

**Can't connect to database?**
- Check your Supabase URL and keys
- Make sure you ran the schema SQL

**AI not responding?**
- Verify your Anthropic API key
- Check you have credits in your Anthropic account

**Page not loading?**
- Make sure `npm run dev` is running
- Check for errors in terminal

**Still stuck?**
- Check browser console (F12) for errors
- Review the README.md for detailed troubleshooting

---

## ✅ You're Done!

You now have a fully functional AI coaching assistant. Start using it, test it with real coaching scenarios, and see how much time it saves you.

Good luck! ⚾

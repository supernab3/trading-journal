# Trading Journal React App

A Vercel-ready static React trading journal that uses Supabase Auth and a Supabase `trades` table for storage.

## Features

- Sign up, login, and logout with Supabase Auth
- Add, edit, delete, filter, export, and import trades
- Track P/L, advanced statistics, equity curve charts, screenshots, and risk management fields
- Generate concise AI trade reviews for entry, exit, risk, discipline, R:R, mistakes, and next-step improvement
- Generate daily AI trading summaries with history by date
- Each user only sees their own trades through Row Level Security

## Project Structure

- `index.html` - the full app, styles, Supabase client, and React logic
- `api/ai-review.js` - Vercel serverless endpoint that calls Gemini securely
- `api/daily-summary.js` - Vercel serverless endpoint that generates and saves daily Gemini summaries
- `vercel.json` - Vercel static deployment settings
- `package.json` - optional Vercel CLI scripts
- `.gitignore` - ignores Vercel and dependency folders

The frontend is intentionally static. Vercel serves `index.html` directly, and the AI endpoints run as Vercel serverless functions.

## Supabase Values

These values are already set in `index.html`:

- `SUPABASE_URL`: `https://spuqofvejpbktfuwiwsy.supabase.co`
- `SUPABASE_ANON_KEY`: `sb_publishable_BxzvNWXpNDLkPiYpRNtvNQ_4Pd83yqi`

Do not put a secret key (`sb_secret_...`) or service role key in this frontend file.
Those keys are backend-only and should be rotated if they were shared.

## Gemini API Key

Do not place the Gemini API key in `index.html`. It belongs on the server only.

For local Vercel testing, create a `.env.local` file:

```bash
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.1-flash-lite
```

`GEMINI_MODEL` is optional. If it is not set, the API endpoint uses `gemini-3.1-flash-lite`, a fast cost-efficient Gemini model. You can also set it to another supported Gemini Flash model.

For Vercel production:

1. Open Vercel Dashboard.
2. Go to Project > Settings > Environment Variables.
3. Add `GEMINI_API_KEY`.
4. Optionally add `GEMINI_MODEL`.
5. Redeploy the project.

## How AI Review Generation Works

1. The user clicks `Generate AI Review` on a trade row.
2. The browser sends the trade data and the current Supabase auth token to `/api/ai-review`.
3. The serverless endpoint verifies the Supabase user token.
4. The endpoint sends a concise mentor-style prompt to the Gemini `generateContent` API.
5. Gemini returns structured JSON with scores, comments, possible mistakes, and one improvement suggestion.
6. The browser saves that review back to the same Supabase trade row.

The prompt tells the AI to act like a professional trading mentor, stay practical, avoid financial guarantees, and focus on discipline and process.

If generation fails, the AI review modal shows the server error and a request ID when available. The Vercel Function logs also include safe debug events for that request ID, Gemini status, model, schema mode, finish reason, and token usage. They do not log the Gemini API key, Supabase token, or full trade payload.

## How Daily AI Summaries Work

1. The user clicks `Generate Daily AI Summary`.
2. The browser automatically filters trades where `trade_date` equals today's local date.
3. The browser aggregates total trades, total P/L, win rate, best trade, worst trade, average risk, high-risk trade count, emotions, notes, and any saved AI trade review text.
4. The browser sends that daily payload and the current Supabase auth token to `/api/daily-summary`.
5. The serverless endpoint verifies the Supabase user token, calls Gemini securely, and saves the summary to Supabase.
6. The frontend updates the Daily Summary modal and history immediately from the saved response.

The endpoint returns a concise mentor-style JSON summary with the most repeated mistake, emotional pattern, risk management quality, and top 3 improvements for tomorrow.

## How AI Reviews Are Stored

AI reviews are stored on the existing `public.trades` table:

- `ai_review` stores the structured JSON review.
- `ai_review_created_at` stores the generated timestamp.

Each trade keeps its own latest review. Regenerating an AI review replaces the previous review for that trade.

## How Daily Summary History Works

Daily summaries are stored in `public.daily_ai_summaries`, one row per user per date. Regenerating a date updates that same row through the `(user_id, summary_date)` unique constraint, so the history list always shows the latest saved summary for each date.

## Estimated Gemini API Costs

As of May 19, 2026, Google's Gemini API pricing page lists `gemini-3.1-flash-lite` paid-tier text pricing at $0.25 per 1M input tokens and $1.50 per 1M output tokens.

- A typical trade review is roughly 700-1,000 input tokens and 250-450 output tokens, so the estimated paid-tier cost is about `$0.0006-$0.0009` per review.
- A typical daily summary with 5-15 trades is roughly 2,000-5,000 input tokens and 500-900 output tokens, so the estimated paid-tier cost is about `$0.0013-$0.0026` per summary.

Google may also provide free-tier quota depending on your account and region. Check the official [Gemini API pricing page](https://ai.google.dev/gemini-api/docs/pricing) before budgeting production usage because model pricing can change.

## Supabase SQL

Run this in the Supabase SQL Editor before using the app in production:

```sql
create extension if not exists pgcrypto;

create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  symbol text not null,
  trade_type text not null check (trade_type in ('long', 'short')),
  entry_price numeric not null,
  exit_price numeric not null,
  position_size numeric not null,
  account_balance_before numeric,
  risk_amount numeric,
  stop_loss_price numeric,
  take_profit_price numeric,
  trade_date date not null,
  emotion text default '',
  notes text default '',
  screenshot_url text default '',
  screenshot_image jsonb,
  ai_review jsonb,
  ai_review_created_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.trades
  add column if not exists ai_review jsonb,
  add column if not exists ai_review_created_at timestamptz;

create table if not exists public.daily_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  summary_date date not null,
  summary_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, summary_date)
);

alter table public.trades enable row level security;
alter table public.daily_ai_summaries enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.trades to authenticated;
grant select, insert, update, delete on public.daily_ai_summaries to authenticated;

drop policy if exists "Users can read their own trades" on public.trades;
drop policy if exists "Users can insert their own trades" on public.trades;
drop policy if exists "Users can update their own trades" on public.trades;
drop policy if exists "Users can delete their own trades" on public.trades;
drop policy if exists "Users can read their own daily summaries" on public.daily_ai_summaries;
drop policy if exists "Users can insert their own daily summaries" on public.daily_ai_summaries;
drop policy if exists "Users can update their own daily summaries" on public.daily_ai_summaries;
drop policy if exists "Users can delete their own daily summaries" on public.daily_ai_summaries;

create policy "Users can read their own trades"
on public.trades
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own trades"
on public.trades
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own trades"
on public.trades
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own trades"
on public.trades
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their own daily summaries"
on public.daily_ai_summaries
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own daily summaries"
on public.daily_ai_summaries
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own daily summaries"
on public.daily_ai_summaries
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own daily summaries"
on public.daily_ai_summaries
for delete
to authenticated
using ((select auth.uid()) = user_id);
```

## Supabase Auth Production Settings

After Vercel gives you a production URL, update Supabase:

1. Open Supabase Dashboard.
2. Go to Authentication > URL Configuration.
3. Set Site URL to your production Vercel URL, for example:
   `https://your-project.vercel.app`
4. Add Redirect URLs:
   - `https://your-project.vercel.app/**`
   - `http://localhost:3000/**` for local Vercel CLI testing
   - optional preview pattern: `https://*-your-vercel-account.vercel.app/**`

This matters for email confirmations, password reset links, and any future OAuth login.

## Deploy to Vercel with Git

1. Push this folder to a GitHub, GitLab, or Bitbucket repository.
2. Open Vercel Dashboard.
3. Click Add New > Project.
4. Import the repository.
5. Set Framework Preset to Other if Vercel asks.
6. Leave Build Command empty. `vercel.json` also sets `buildCommand` to `null`.
7. Leave Output Directory as `.`. `vercel.json` also sets this.
8. Click Deploy.
9. Copy the production URL and add it to Supabase Auth URL Configuration.
10. Open the deployed app and test login plus trades.

## Deploy to Vercel with CLI

From this project folder:

```bash
npm install -g vercel
vercel login
vercel
vercel --prod
```

When prompted:

- Link to an existing project or create a new one.
- Use the current folder as the project root.
- Keep the default static deployment settings from `vercel.json`.

## Production Test Checklist

- Register user A, add trades, then log out.
- Register user B and confirm user A's trades are not visible.
- Add, edit, and delete trades.
- Test filters, stats, risk cards, and charts after each change.
- Add at least one trade dated today, then generate a Daily AI Summary.
- Confirm the summary appears in the modal without refresh and in Summary History.
- Regenerate the same date and confirm the existing history row updates.
- Log in as another user and confirm daily summary history is private.
- Upload a small screenshot and confirm the thumbnail/modal works.
- Export JSON, import it back, and confirm rows save to Supabase.
- Refresh the deployed page and confirm the logged-in session and trades load again.

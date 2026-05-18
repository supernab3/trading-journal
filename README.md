# Trading Journal React App

A Vercel-ready static React trading journal that uses Supabase Auth and a Supabase `trades` table for storage.

## Features

- Sign up, login, and logout with Supabase Auth
- Add, edit, delete, filter, export, and import trades
- Track P/L, advanced statistics, equity curve charts, screenshots, and risk management fields
- Each user only sees their own trades through Row Level Security

## Project Structure

- `index.html` - the full app, styles, Supabase client, and React logic
- `vercel.json` - Vercel static deployment settings
- `package.json` - optional Vercel CLI scripts
- `.gitignore` - ignores Vercel and dependency folders

The app is intentionally static. Vercel serves `index.html` directly, so no build step is required.

## Supabase Values

These values are already set in `index.html`:

- `SUPABASE_URL`: `https://spuqofvejpbktfuwiwsy.supabase.co`
- `SUPABASE_ANON_KEY`: `sb_publishable_BxzvNWXpNDLkPiYpRNtvNQ_4Pd83yqi`

Do not put a secret key (`sb_secret_...`) or service role key in this frontend file.
Those keys are backend-only and should be rotated if they were shared.

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
  created_at timestamptz not null default now()
);

alter table public.trades enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.trades to authenticated;

drop policy if exists "Users can read their own trades" on public.trades;
drop policy if exists "Users can insert their own trades" on public.trades;
drop policy if exists "Users can update their own trades" on public.trades;
drop policy if exists "Users can delete their own trades" on public.trades;

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
- Upload a small screenshot and confirm the thumbnail/modal works.
- Export JSON, import it back, and confirm rows save to Supabase.
- Refresh the deployed page and confirm the logged-in session and trades load again.

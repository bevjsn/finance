# Cloud Sync Setup (optional)

Attending Launch works fully **without** any of this — your plan and scenarios
are saved in your browser. Cloud sync just lets you **log in and access the same
plan from any device**. It's powered by [Supabase](https://supabase.com) (free
tier is plenty).

You only do this once. Three steps, ~5 minutes.

## 1. Create a free Supabase project
1. Go to <https://supabase.com> → sign up → **New project**.
2. Pick a name and a database password (you won't need the password again here).
3. Wait ~1 minute for it to provision.

## 2. Create the data table
In your project, open **SQL Editor** → **New query**, paste the following, and
click **Run**:

```sql
-- One row per user: their plan + saved scenarios.
create table if not exists public.al_data (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  plan       jsonb,
  scenarios  jsonb,
  updated_at timestamptz default now()
);

-- Row-level security: each user can only see/edit their own row.
alter table public.al_data enable row level security;

create policy "own rows - select" on public.al_data
  for select using (auth.uid() = user_id);
create policy "own rows - insert" on public.al_data
  for insert with check (auth.uid() = user_id);
create policy "own rows - update" on public.al_data
  for update using (auth.uid() = user_id);
```

(Email magic-link login is enabled by default under **Authentication →
Providers → Email**. No password setup needed.)

> If you host the app at a URL like `https://bevjsn.github.io/finance/`, add that
> URL under **Authentication → URL Configuration → Redirect URLs** so magic-link
> sign-ins return to the app.

## 3. Connect the app
1. In Supabase, open **Project Settings → API**.
2. Copy the **Project URL** and the **anon / public** key.
3. In Attending Launch, click **☁ Set up sync** (top right), paste both values,
   and hit **Save & reload**.
4. Click **Sign in**, enter your email, and open the magic link we send you.

That's it — your plan and scenarios now sync automatically across any device
where you sign in. The URL/key are stored only in your browser; the anon key is
safe to expose because row-level security restricts every user to their own data.

## Notes
- **Local-first:** the app always reads/writes your browser first, then mirrors
  to the cloud in the background, so it stays fast and works offline.
- **Privacy:** your financial inputs live in your own Supabase project, under
  your control. Nothing is sent anywhere else.
- **Turning it off:** sign out to go back to local-only. Clearing the browser's
  storage also removes the saved connection.

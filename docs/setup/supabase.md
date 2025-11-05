# Supabase Setup Guide

This project uses Supabase for authentication, lobby management, and storing finished matches. Follow the steps below to provision the backend and connect the web app.

## 1. Create the Supabase project
1. Sign in at [https://supabase.com](https://supabase.com) and create a new project.
2. Choose a region close to your players. The free tier is sufficient for development.
3. After the project is created, open **Project Settings → API** and copy the **Project URL** and **anon key** – you will need them later as environment variables.

## 2. Enable email magic-link authentication
1. Go to **Authentication → Providers** and ensure **Email** is enabled.
2. In the **Email** section, keep the default *Magic Link* sign-in mode (the app only requests magic links).
3. Set **Site URL** under **Authentication → URL configuration** to your local dev URL (e.g. `http://localhost:5174`). Supabase will redirect users here after they click the magic link.
4. *(Optional)* Enable Google sign-in by following the step-by-step instructions in [`google-auth.md`](./google-auth.md). The frontend already includes a Google button once the provider is configured.

## 3. Apply the database schema
1. Open **Database → SQL Editor**.
2. Run the SQL script you already shared (enums, `players`, `matches`, `match_moves`, and indexes). Re-run it any time you reset the project.

```sql
create type match_visibility as enum ('public', 'private');
create type match_status as enum (
  'waiting_for_opponent',
  'in_progress',
  'completed',
  'abandoned'
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users (id) on delete cascade,
  display_name text not null,
  rating integer not null default 1500,
  games_played integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.players (id) on delete cascade,
  opponent_id uuid references public.players (id) on delete set null,
  visibility match_visibility not null default 'public',
  rated boolean not null default true,
  private_join_code text,
  clock_initial_seconds integer not null default 600,
  clock_increment_seconds integer not null default 5,
  status match_status not null default 'waiting_for_opponent',
  winner_id uuid references public.players (id) on delete set null,
  rematch_parent_id uuid references public.matches (id) on delete set null,
  created_at timestamptz not null default now(),
  initial_state jsonb not null
);

create table public.match_moves (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  move_index integer not null,
  player_id uuid not null references public.players (id) on delete cascade,
  action jsonb not null,
  state_snapshot jsonb,
  eval_snapshot jsonb,
  created_at timestamptz not null default now(),
  unique (match_id, move_index)
);

create index idx_matches_visibility on public.matches (visibility);
create index idx_matches_private_join_code on public.matches (private_join_code);
create index idx_match_moves_match_id on public.match_moves (match_id);
```

## 4. Enable Row Level Security (RLS)
Supabase enables RLS automatically when you create new tables. Add the following policies so only the right players can read/write data.

### players policies
Run each snippet in the SQL editor.

```sql
alter table public.players enable row level security;

create policy "Players can view their profile"
  on public.players for select
  using (auth.uid() = auth_user_id);

create policy "Players can insert their profile"
  on public.players for insert
  with check (auth.uid() = auth_user_id);

create policy "Players can update their profile"
  on public.players for update
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);
```

### matches policies
```sql
alter table public.matches enable row level security;

create policy "Public matches are visible to everyone"
  on public.matches for select
  using (
    visibility = 'public' or
    creator_id in (select id from public.players where auth_user_id = auth.uid()) or
    opponent_id in (select id from public.players where auth_user_id = auth.uid())
  );

create policy "Creators can manage their matches"
  on public.matches for insert
  with check (
    creator_id in (select id from public.players where auth_user_id = auth.uid())
  );

create policy "Participants can update their match"
  on public.matches for update
  using (
    creator_id in (select id from public.players where auth_user_id = auth.uid()) or
    opponent_id in (select id from public.players where auth_user_id = auth.uid())
  )
  with check (
    creator_id in (select id from public.players where auth_user_id = auth.uid()) or
    opponent_id in (select id from public.players where auth_user_id = auth.uid())
  );
```

### match_moves policies
```sql
alter table public.match_moves enable row level security;

create policy "Participants can read moves"
  on public.match_moves for select
  using (
    match_id in (
      select id from public.matches
      where
        creator_id in (select id from public.players where auth_user_id = auth.uid()) or
        opponent_id in (select id from public.players where auth_user_id = auth.uid()) or
        visibility = 'public'
    )
  );

-- Moves must be inserted via the server-side validator. Do not add an
-- insert policy so regular clients cannot bypass validation.
```

> **Tip:** You can expose completed games for spectators by adjusting the `select` policies to allow everyone to read rows where `status = 'completed'`.

## 5. Enable Realtime on the tables
Supabase needs to broadcast changes from `matches` and `match_moves` so the lobby and the clocks update instantly. Depending on
your project, the Replication UI may not be available, so follow whichever path you see in the dashboard:

- **If you have the Realtime UI:** go to **Database → Replication → Realtime** and add `public.matches` and
  `public.match_moves` to the enabled tables.
- **If the Replication menu is missing:** open the SQL editor and run the commands below to attach both tables to the
  `supabase_realtime` publication manually.

  ```sql
  alter publication supabase_realtime add table public.matches;
  alter publication supabase_realtime add table public.match_moves;
  ```
1. Navigate to **Database → Replication → Realtime**.
2. Add `public.matches` and `public.match_moves` to the enabled tables. The lobby and in-game updates depend on these realtime streams.

## 6. Configure the web app
1. Create `web/.env.local` and fill in the values you copied earlier:

   ```bash
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   ```

2. Install dependencies and start the dev server:

   ```bash
   cd web
   npm install
   npm run dev
   ```

3. Open the Play tab. If you are not signed in yet, the page shows the **Sign in to play** card. Enter an email address to receive a magic link. Clicking the link creates your `players` row automatically and unlocks the lobby.

## 7. (Optional) Service role automation
If you later add rating updates or scheduled tasks, create SQL functions that run with the service role and call them from backend jobs. For the current frontend-only prototype no extra functions are required.

After completing these steps the Practice, Play, and Analyze workspaces should function end-to-end with your Supabase project.

-- ===========================================
-- 価値観マッチングアプリ - Supabase スキーマ
-- ===========================================
-- Supabase Dashboard > SQL Editor でこのSQLを実行してください。

-- 1. rooms テーブル
create table if not exists public.rooms (
  id uuid default gen_random_uuid() primary key,
  code text not null unique,
  status text not null default 'waiting'
    check (status in ('waiting', 'playing', 'calculating', 'result')),
  host_id text not null,
  created_at timestamptz default now() not null
);

-- 2. participants テーブル
create table if not exists public.participants (
  id uuid default gen_random_uuid() primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  user_id text not null,
  name text not null,
  answers jsonb default '[]'::jsonb not null,
  is_finished boolean default false not null,
  created_at timestamptz default now() not null
);

-- インデックス
create index if not exists idx_participants_room_code on public.participants(room_code);
create index if not exists idx_rooms_code on public.rooms(code);

-- 3. Row Level Security (RLS)
alter table public.rooms enable row level security;
alter table public.participants enable row level security;

-- 匿名ユーザーを含む全員が読み書きできるポリシー
-- （本番環境ではより厳密なポリシーに変更してください）
create policy "rooms_select" on public.rooms for select using (true);
create policy "rooms_insert" on public.rooms for insert with check (true);
create policy "rooms_update" on public.rooms for update using (true);

create policy "participants_select" on public.participants for select using (true);
create policy "participants_insert" on public.participants for insert with check (true);
create policy "participants_update" on public.participants for update using (true);

-- 4. Realtime を有効化
-- Supabase Dashboard > Database > Replication で rooms と participants を有効にするか、
-- 以下のSQLを実行してください：
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.participants;

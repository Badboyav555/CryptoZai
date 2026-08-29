-- ============================================================================
--  VaultBit — Crypto Wallet SIMULATOR · Supabase schema
--  Run this whole file in: Supabase Dashboard → SQL Editor
--
--  ⚠ SIMULATOR / TESTING ARCHITECTURE:
--  Supabase Auth is intentionally NOT used. The app keeps its own session in
--  localStorage and talks to the DB with the anon key, so the RLS policies
--  below are deliberately permissive FOR THE SIMULATOR ONLY. Never ship this
--  to production without replacing them with Supabase-Auth-based policies.
--
--  CREATING THE FIRST ADMIN (safe method, no hardcoded credentials):
--    1) Deploy the app and sign up normally inside index.html.
--    2) Run:  update public.users set role = 'admin' where mobile = 'YOUR_MOBILE';
--    3) Log in at admin.html with that account's mobile/email + password.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------- USERS ---
create table if not exists public.users (
  id            uuid primary key default gen_random_uuid(),
  username      text        not null,
  email         text,
  mobile        text        not null,
  password_hash text        not null,              -- "salt$hash" (simulator grade)
  role          text        not null default 'user' check (role in ('user','admin')),
  is_active     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_login    timestamptz,
  constraint users_username_key unique (username),
  constraint users_mobile_key   unique (mobile),
  constraint users_email_key    unique (email)
);
create index if not exists users_role_idx   on public.users (role);
create index if not exists users_active_idx on public.users (is_active);

-- --------------------------------------------------------------- WALLETS ---
create table if not exists public.wallets (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null,
  wallet_address text not null,
  btc_balance    numeric(24,8) not null default 0 check (btc_balance  >= 0),
  eth_balance    numeric(24,8) not null default 0 check (eth_balance  >= 0),
  usdt_balance   numeric(24,8) not null default 0 check (usdt_balance >= 0),
  sol_balance    numeric(24,8) not null default 0 check (sol_balance  >= 0),
  xrp_balance    numeric(24,8) not null default 0 check (xrp_balance  >= 0),
  doge_balance   numeric(24,8) not null default 0 check (doge_balance >= 0),
  bnb_balance    numeric(24,8) not null default 0 check (bnb_balance  >= 0),
  inr_balance    numeric(18,2) not null default 0 check (inr_balance  >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint wallets_user_id_fkey foreign key (user_id)
    references public.users(id) on delete cascade,
  constraint wallets_user_id_key unique (user_id),
  constraint wallets_address_key unique (wallet_address)
);
create index if not exists wallets_address_idx on public.wallets (wallet_address);

-- ----------------------------------------------------------- TRANSACTIONS ---
create table if not exists public.transactions (
  id               uuid primary key default gen_random_uuid(),
  sender_id        uuid,
  receiver_id      uuid,
  coin             text not null check (coin in ('BTC','ETH','USDT','SOL','XRP','DOGE','BNB','INR')),
  amount           numeric(30,8) not null check (amount > 0),
  amount_inr       numeric(20,2) not null default 0,
  tx_hash          text not null,
  status           text not null default 'Processing'
                     check (status in ('Processing','Completed','Failed','Rejected')),
  confirmations    int  not null default 0 check (confirmations between 0 and 99),
  transaction_type text not null
                     check (transaction_type in ('sent','received','withdrawal','admin_credit','admin_debit','deposit')),
  note             text,
  created_at       timestamptz not null default now(),
  constraint transactions_sender_id_fkey   foreign key (sender_id)   references public.users(id) on delete set null,
  constraint transactions_receiver_id_fkey foreign key (receiver_id) references public.users(id) on delete set null
);
create index if not exists tx_sender_idx   on public.transactions (sender_id);
create index if not exists tx_receiver_idx on public.transactions (receiver_id);
create index if not exists tx_hash_idx     on public.transactions (tx_hash);
create index if not exists tx_created_idx  on public.transactions (created_at desc);

-- ------------------------------------------------------------ WITHDRAWALS ---
create table if not exists public.withdrawals (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null,
  coin                      text not null check (coin in ('BTC','ETH','USDT','SOL','XRP','DOGE','BNB')),
  crypto_amount             numeric(30,8) not null check (crypto_amount > 0),
  amount_inr                numeric(20,2) not null default 0,
  withdrawal_method         text not null check (withdrawal_method in ('UPI','BANK')),
  upi_id                    text,
  bank_name                 text,
  account_holder_name       text,
  account_number            text,
  ifsc_code                 text,
  status                    text not null default 'Processing'
                              check (status in ('Processing','Completed','Failed','Rejected')),
  processing_days_remaining int not null default 3,
  estimated_arrival         timestamptz,
  completed_at              timestamptz,
  tx_hash                   text,
  created_at                timestamptz not null default now(),
  constraint withdrawals_user_id_fkey foreign key (user_id)
    references public.users(id) on delete cascade
);
create index if not exists wd_user_idx   on public.withdrawals (user_id);
create index if not exists wd_status_idx on public.withdrawals (status);

-- ---------------------------------------------------------- NOTIFICATIONS ---
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  title       text not null,
  message     text not null,
  read_status boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint notifications_user_id_fkey foreign key (user_id)
    references public.users(id) on delete cascade
);
create index if not exists notif_user_idx on public.notifications (user_id, read_status);
create index if not exists notif_created_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------- MARKET PRICES ---
create table if not exists public.market_prices (
  id                 uuid primary key default gen_random_uuid(),
  coin_name          text not null,
  symbol             text not null unique,
  current_price_inr  numeric(20,4) not null default 0,
  change_percentage  numeric(12,4) not null default 0,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------- ANNOUNCEMENTS ---
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  message    text not null,
  type       text not null default 'General'
               check (type in ('General','Market','Maintenance','Security')),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint announcements_created_by_fkey foreign key (created_by)
    references public.users(id) on delete set null
);

-- ------------------------------------------------------- updated_at touch ---
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create trigger trg_users_updated    before update on public.users    for each row execute function public.touch_updated_at();
create trigger trg_wallets_updated  before update on public.wallets  for each row execute function public.touch_updated_at();
create trigger trg_prices_updated   before update on public.market_prices for each row execute function public.touch_updated_at();

-- --------------------------------------------- business-day helper (3 days) --
create or replace function public.add_business_days(from_ts timestamptz, days int)
returns timestamptz language plpgsql as $$ declare d timestamptz := from_ts; added int := 0;
begin
  while added < days loop
    d := d + interval '1 day';
    if extract(dow from d) not in (0,6) then added := added + 1; end if;
  end loop;
  return d;
end $$;

-- ------------------------------------------------------- seed market prices --
insert into public.market_prices (coin_name, symbol, current_price_inr, change_percentage) values
  ('Bitcoin',  'BTC', 9250000.00,  1.84),
  ('Ethereum', 'ETH', 241500.00,  -0.62),
  ('Tether',   'USDT',   86.40,   0.03),
  ('Solana',   'SOL', 14680.00,   3.11),
  ('XRP',      'XRP',   192.50,  -1.24),
  ('Dogecoin', 'DOGE',   14.62,   2.47),
  ('BNB',      'BNB', 52400.00,   0.58)
on conflict (symbol) do nothing;

-- -------------------------------------------------- realtime publication ----
do $$ declare t text;
begin
  foreach t in array array['users','wallets','transactions','withdrawals','notifications','market_prices','announcements']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
             when undefined_object then null;
    end;
  end loop;
end $$;

-- ===================================================================
--  RLS — SIMULATOR-GRADE (permissive for anon; see warning at top)
-- ===================================================================
do $$ declare t text; begin
  foreach t in array array['users','wallets','transactions','withdrawals',
                           'notifications','market_prices','announcements']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

create policy users_anon_select  on public.users        for select to anon using (true);
create policy users_anon_insert  on public.users        for insert to anon with check (true);
create policy users_anon_update  on public.users        for update to anon using (true) with check (true);

create policy wallets_anon_select on public.wallets     for select to anon using (true);
create policy wallets_anon_insert on public.wallets     for insert to anon with check (true);
create policy wallets_anon_update on public.wallets     for update to anon using (true) with check (true);

create policy tx_anon_select  on public.transactions    for select to anon using (true);
create policy tx_anon_insert  on public.transactions    for insert to anon with check (true);
create policy tx_anon_update  on public.transactions    for update to anon using (true) with check (true);

create policy wd_anon_select  on public.withdrawals     for select to anon using (true);
create policy wd_anon_insert  on public.withdrawals     for insert to anon with check (true);
create policy wd_anon_update  on public.withdrawals     for update to anon using (true) with check (true);

create policy notif_anon_select  on public.notifications for select to anon using (true);
create policy notif_anon_insert  on public.notifications for insert to anon with check (true);
create policy notif_anon_update  on public.notifications for update to anon using (true) with check (true);
create policy notif_anon_delete  on public.notifications for delete to anon using (true);

create policy prices_anon_select on public.market_prices for select to anon using (true);
create policy prices_anon_insert on public.market_prices for insert to anon with check (true);
create policy prices_anon_update on public.market_prices for update to anon using (true) with check (true);

create policy ann_anon_select on public.announcements    for select to anon using (true);
create policy ann_anon_insert on public.announcements    for insert to anon with check (true);
create policy ann_anon_delete on public.announcements    for delete to anon using (true);

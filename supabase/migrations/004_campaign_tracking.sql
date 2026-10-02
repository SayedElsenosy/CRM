alter table public.applicants add column if not exists campaign_id text;
alter table public.applicants add column if not exists ad_id text;
alter table public.applicants add column if not exists source text;
create table if not exists public.campaigns(
 id uuid primary key default gen_random_uuid(),
 name text not null,
 campaign_id text unique,
 created_at timestamptz default now()
);

-- Area intelligence data
create table if not exists public.areas (
 id uuid primary key default gen_random_uuid(),
 name text unique not null,
 description text default '',
 working_hours text default '',
 pickup_points text default '',
 salary_info text default '',
 active boolean default true,
 created_at timestamptz default now()
);

alter table public.areas enable row level security;
revoke all on public.areas from anon, authenticated;
grant select on public.areas to authenticated;

create policy "recruiters read areas" on public.areas
for select to authenticated using ((select public.is_recruiter()));

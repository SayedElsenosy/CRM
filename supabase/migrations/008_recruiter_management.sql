-- Recruiter assignment
create table if not exists public.recruiters (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 phone text,
 email text,
 assigned_area text,
 active boolean default true,
 created_at timestamptz default now()
);

alter table public.applicants add column if not exists assigned_recruiter uuid references public.recruiters(id);
alter table public.recruiters enable row level security;
revoke all on public.recruiters from anon, authenticated;
grant select on public.recruiters to authenticated;

create policy "recruiters read recruiters" on public.recruiters
for select to authenticated using ((select public.is_recruiter()));

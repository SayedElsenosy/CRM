-- Run after 005_dynamic_flow_safety.sql, before deploying the updated webhook.
create table if not exists public.delivery_zones (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (
    length(btrim(name)) between 2 and 100 and name = btrim(name)
    and position(chr(10) in name) = 0 and position(chr(13) in name) = 0
  ),
  details text not null default '' check (length(details) <= 2000),
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists delivery_zones_active_order
on public.delivery_zones (sort_order, name) where is_active;

drop trigger if exists delivery_zones_set_updated_at on public.delivery_zones;
create trigger delivery_zones_set_updated_at
before update on public.delivery_zones
for each row execute function public.set_updated_at();

-- The existing choices are names only. Recruiters add confirmed operational
-- details in the dashboard; no pay, address, or shift terms are presumed.
insert into public.delivery_zones (name, sort_order)
values
  ('أكتوبر', 10), ('التجمع', 20), ('مدينتي', 30), ('الشروق', 40),
  ('الرحاب', 50), ('العبور', 60), ('مدينة نصر', 70), ('النزهة', 80),
  ('الظاهر', 90), ('الهرم', 100), ('الشيخ زايد', 110)
on conflict (name) do nothing;

alter table public.applicant_sessions
add column if not exists pending_zone_id uuid references public.delivery_zones(id) on delete set null;

-- Existing legacy applicants may still be waiting for their area.
alter table public.applicants drop constraint if exists applicants_state_check;
alter table public.applicants add constraint applicants_state_check check (state in (
  'NEW', 'WAITING_AGE', 'WAITING_AREA', 'WAITING_AREA_CONFIRMATION',
  'WAITING_MOTORCYCLE', 'WAITING_LICENSE', 'WAITING_SHIFT',
  'WAITING_ID_DOC', 'WAITING_LICENSE_DOC', 'READY_FOR_RECRUITER',
  'HUMAN_HANDOFF', 'NOT_ELIGIBLE', 'DYNAMIC_FLOW'
));

-- Replace only the previous seed text, preserving staff edits.
update public.bot_questions
set question_text = 'أنهي منطقة مناسبة ليك للعمل؟'
where question_key = 'area' and question_text =
  'أنهي منطقة مناسبة ليك للعمل؟ أكتوبر - التجمع - مدينتي - الشروق - الرحاب - العبور - مدينة نصر - النزهة - الظاهر - الهرم - الشيخ زايد';

alter table public.delivery_zones enable row level security;
revoke all on public.delivery_zones from anon, authenticated;
grant select, insert, update on public.delivery_zones to authenticated;

drop policy if exists "recruiters read delivery zones" on public.delivery_zones;
create policy "recruiters read delivery zones" on public.delivery_zones
for select to authenticated using ((select public.is_recruiter()));
drop policy if exists "recruiters add delivery zones" on public.delivery_zones;
create policy "recruiters add delivery zones" on public.delivery_zones
for insert to authenticated with check ((select public.is_recruiter()));
drop policy if exists "recruiters edit delivery zones" on public.delivery_zones;
create policy "recruiters edit delivery zones" on public.delivery_zones
for update to authenticated using ((select public.is_recruiter()))
with check ((select public.is_recruiter()));

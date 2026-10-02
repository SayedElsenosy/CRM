-- Breadfast delivery rider recruitment bot - MVP schema
create extension if not exists pgcrypto;

create table if not exists public.applicants (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  whatsapp_name text,
  age integer check (age is null or age between 1 and 100),
  preferred_area text,
  has_motorcycle boolean,
  has_motorcycle_license boolean,
  accepts_nine_hour_shift boolean,
  state text not null default 'NEW' check (state in (
    'NEW',
    'WAITING_AGE',
    'WAITING_AREA',
    'WAITING_MOTORCYCLE',
    'WAITING_LICENSE',
    'WAITING_SHIFT',
    'WAITING_ID_DOC',
    'WAITING_LICENSE_DOC',
    'READY_FOR_RECRUITER',
    'HUMAN_HANDOFF',
    'NOT_ELIGIBLE'
  )),
  rejection_reason text,
  ai_active boolean not null default true,
  source text default 'click_to_whatsapp',
  campaign_ref text,
  ad_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  handoff_at timestamptz
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.applicants(id) on delete cascade,
  wa_message_id text unique,
  direction text not null check (direction in ('INBOUND','OUTBOUND')),
  message_type text not null,
  body text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.applicants(id) on delete cascade,
  kind text not null check (kind in ('ID_IMAGE','MOTORCYCLE_LICENSE_IMAGE')),
  wa_media_id text,
  mime_type text,
  storage_path text,
  received_at timestamptz not null default now(),
  unique(applicant_id, kind)
);

create index if not exists idx_applicants_state on public.applicants(state);
create index if not exists idx_applicants_created_at on public.applicants(created_at desc);
create index if not exists idx_messages_applicant_created on public.messages(applicant_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists applicants_set_updated_at on public.applicants;
create trigger applicants_set_updated_at
before update on public.applicants
for each row execute function public.set_updated_at();

-- Private bucket for recruitment documents. Do not make this public.
insert into storage.buckets (id, name, public)
values ('recruitment-documents', 'recruitment-documents', false)
on conflict (id) do update set public = false;

alter table public.applicants enable row level security;
alter table public.messages enable row level security;
alter table public.documents enable row level security;

-- No public policies are intentionally created in the MVP.
-- Edge Functions use the service role; the future recruiter dashboard should use authenticated users + explicit RLS policies.

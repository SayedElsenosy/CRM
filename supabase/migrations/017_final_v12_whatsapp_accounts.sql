-- Run after 005. Compatible with installations that already ran 006_whatsapp_accounts.sql.
-- Metadata is readable only through the authenticated admin Edge Function.
create table if not exists public.whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone_number text not null,
  phone_number_id text not null unique,
  business_account_id text,
  access_token text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_accounts alter column access_token drop not null;
alter table public.whatsapp_accounts add column if not exists token_ciphertext text;
alter table public.whatsapp_accounts add column if not exists token_iv text;
alter table public.whatsapp_accounts add column if not exists is_default boolean not null default false;
create unique index if not exists whatsapp_accounts_one_default
  on public.whatsapp_accounts (is_default) where is_default;

drop trigger if exists whatsapp_accounts_set_updated_at on public.whatsapp_accounts;
create trigger whatsapp_accounts_set_updated_at
before update on public.whatsapp_accounts
for each row execute function public.set_updated_at();

alter table public.applicants add column if not exists last_whatsapp_phone_number_id text;
alter table public.messages add column if not exists whatsapp_phone_number_id text;
create index if not exists messages_whatsapp_phone_number_idx
  on public.messages (whatsapp_phone_number_id, created_at desc);

alter table public.whatsapp_accounts enable row level security;
drop policy if exists "recruiters read whatsapp accounts" on public.whatsapp_accounts;
revoke all on public.whatsapp_accounts from anon, authenticated;
-- The webhook and authenticated admin function use service role. Never grant
-- table SELECT to the dashboard because historic 006 stored tokens in plain text.

-- Refresh the existing prototype view using the real applicant state column.
create or replace view public.crm_dashboard_metrics with (security_invoker = true) as
select
  count(*) as total_applicants,
  count(*) filter (where created_at::date = current_date) as today_applicants,
  count(*) filter (where state = 'READY_FOR_RECRUITER') as ready_for_recruiter,
  count(*) filter (where state = 'NOT_ELIGIBLE') as rejected
from public.applicants;
revoke all on public.crm_dashboard_metrics from anon, authenticated;
grant select on public.crm_dashboard_metrics to authenticated;

create or replace function public.set_default_whatsapp_account(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_recruiter() then
    raise exception 'Recruiter access required' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(20260929);
  if not exists (
    select 1 from public.whatsapp_accounts
    where id = p_id and status = 'ACTIVE' and token_ciphertext is not null
  ) then
    raise exception 'Choose an active account with a configured token' using errcode = '22023';
  end if;
  update public.whatsapp_accounts set is_default = false where is_default;
  update public.whatsapp_accounts set is_default = true where id = p_id;
end;
$$;
revoke all on function public.set_default_whatsapp_account(uuid) from public, anon;
grant execute on function public.set_default_whatsapp_account(uuid) to authenticated;

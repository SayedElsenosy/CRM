-- Multi WhatsApp accounts support
create table if not exists public.whatsapp_accounts (
 id uuid primary key default gen_random_uuid(),
 name text not null,
 phone_number text not null,
 phone_number_id text not null unique,
 business_account_id text,
 access_token text not null,
 status text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
 created_at timestamptz default now(),
 updated_at timestamptz default now()
);

alter table public.whatsapp_accounts enable row level security;
revoke all on public.whatsapp_accounts from anon, authenticated;
grant select on public.whatsapp_accounts to authenticated;

create policy "recruiters read whatsapp accounts" on public.whatsapp_accounts
for select to authenticated using ((select public.is_recruiter()));

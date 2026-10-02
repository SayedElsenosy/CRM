-- Staff-only access to applicant records and private document objects.
-- Run after 001_initial_schema.sql in the same Supabase project.
create table if not exists public.recruiter_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.recruiter_reviews (
  applicant_id uuid primary key references public.applicants(id) on delete cascade,
  review_status text not null default 'NEW' check (review_status in ('NEW', 'IN_REVIEW', 'CONTACTED', 'CLOSED')),
  notes text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_recruiter_reviews_status on public.recruiter_reviews(review_status);

alter table public.recruiter_users enable row level security;
alter table public.recruiter_reviews enable row level security;

-- The service role provisions staff. No client can read or modify the allowlist.
revoke all on public.recruiter_users from anon, authenticated;
revoke all on public.applicants, public.messages, public.documents, public.recruiter_reviews from anon, authenticated;
grant select on public.applicants, public.messages, public.documents, public.recruiter_reviews to authenticated;

create or replace function public.is_recruiter()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.recruiter_users where user_id = auth.uid()
  );
$$;
revoke all on function public.is_recruiter() from public, anon;
grant execute on function public.is_recruiter() to authenticated;

create policy "recruiters read applicants" on public.applicants
for select to authenticated using ((select public.is_recruiter()));
create policy "recruiters read messages" on public.messages
for select to authenticated using ((select public.is_recruiter()));
create policy "recruiters read documents" on public.documents
for select to authenticated using ((select public.is_recruiter()));
create policy "recruiters read reviews" on public.recruiter_reviews
for select to authenticated using ((select public.is_recruiter()));

create policy "recruiters read private documents" on storage.objects
for select to authenticated
using (bucket_id = 'recruitment-documents' and (select public.is_recruiter()));

-- Constrain edits to recruiter status and internal notes; the WhatsApp state stays untouched.
create or replace function public.save_recruiter_review(
  p_applicant_id uuid,
  p_review_status text,
  p_notes text
)
returns void language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_recruiter() then
    raise exception 'Recruiter access required' using errcode = '42501';
  end if;
  if p_review_status is null or p_review_status not in ('NEW', 'IN_REVIEW', 'CONTACTED', 'CLOSED') then
    raise exception 'Invalid review status' using errcode = '22023';
  end if;
  if p_notes is null or length(p_notes) > 2000 then
    raise exception 'Notes must be at most 2000 characters' using errcode = '22023';
  end if;

  insert into public.recruiter_reviews (applicant_id, review_status, notes, updated_by, updated_at)
  values (p_applicant_id, p_review_status, p_notes, auth.uid(), now())
  on conflict (applicant_id) do update
  set review_status = excluded.review_status,
      notes = excluded.notes,
      updated_by = excluded.updated_by,
      updated_at = now();
end;
$$;
revoke all on function public.save_recruiter_review(uuid, text, text) from public, anon;
grant execute on function public.save_recruiter_review(uuid, text, text) to authenticated;

-- Human takeover controls

alter table public.applicants
add column if not exists ai_paused boolean default false,
add column if not exists assigned_recruiter_id uuid;

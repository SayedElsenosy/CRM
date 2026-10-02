-- CRM applicant actions support
alter table applicants add column if not exists assigned_recruiter_id uuid;
alter table applicants add column if not exists ai_paused boolean default false;
create index if not exists idx_applicants_status on applicants(status);

-- v4.1 Realtime inbox preparation
alter table messages enable row level security;

-- Add indexes for inbox queries
create index if not exists idx_messages_applicant_created
on messages(applicant_id, created_at desc);

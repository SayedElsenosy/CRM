create index if not exists idx_messages_applicant_created_at
on messages(applicant_id, created_at desc);

create index if not exists idx_conversations_updated_at
on conversations(updated_at desc);

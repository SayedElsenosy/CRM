alter table if exists conversations
add column if not exists status text default 'OPEN';

create index if not exists idx_conversations_status
on conversations(status);

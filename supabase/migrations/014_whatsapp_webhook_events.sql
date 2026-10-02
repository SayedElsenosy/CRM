-- v4.2 webhook event storage

create table if not exists whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz default now()
);

create index if not exists idx_whatsapp_webhook_events_created
on whatsapp_webhook_events(created_at desc);

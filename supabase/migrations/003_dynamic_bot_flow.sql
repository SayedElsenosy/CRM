-- Dynamic bot flow foundation
create table if not exists public.bot_questions (
  id uuid primary key default gen_random_uuid(),
  question_text text not null,
  question_type text not null default 'text',
  options jsonb,
  step_order integer not null,
  is_required boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_answers (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.applicants(id) on delete cascade,
  question_id uuid not null references public.bot_questions(id) on delete cascade,
  answer_value text,
  created_at timestamptz not null default now()
);

create table if not exists public.applicant_sessions (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null unique references public.applicants(id) on delete cascade,
  current_question_id uuid references public.bot_questions(id),
  completion_percentage integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into public.bot_questions(question_text, question_type, step_order)
select * from (values
 ('كم عمرك؟','number',1),
 ('ما المنطقة المناسبة للعمل؟','select',2),
 ('هل لديك موتوسيكل؟','yes_no',3),
 ('هل لديك رخصة موتوسيكل؟','yes_no',4),
 ('هل نظام 9 ساعات مناسب لك؟','yes_no',5),
 ('ارسل صورة البطاقة','image',6),
 ('ارسل صورة رخصة الموتوسيكل','image',7)
) as q(question_text,question_type,step_order)
where not exists (select 1 from public.bot_questions);

alter table public.bot_questions enable row level security;
alter table public.bot_answers enable row level security;
alter table public.applicant_sessions enable row level security;

create index if not exists idx_bot_questions_order on public.bot_questions(step_order);
create index if not exists idx_bot_answers_applicant on public.bot_answers(applicant_id);

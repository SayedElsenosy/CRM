-- Apply after 003_dynamic_bot_flow.sql and 004_campaign_tracking.sql.
-- The prior v2.2 package attempted to write DYNAMIC_FLOW without adding it to this check.
alter table public.applicants drop constraint if exists applicants_state_check;
alter table public.applicants add constraint applicants_state_check check (state in (
  'NEW', 'WAITING_AGE', 'WAITING_AREA', 'WAITING_MOTORCYCLE',
  'WAITING_LICENSE', 'WAITING_SHIFT', 'WAITING_ID_DOC',
  'WAITING_LICENSE_DOC', 'READY_FOR_RECRUITER', 'HUMAN_HANDOFF',
  'NOT_ELIGIBLE', 'DYNAMIC_FLOW'
));

-- A stable key defines how to validate each core answer even if wording/order changes.
alter table public.bot_questions add column if not exists question_key text;
update public.bot_questions set question_key = case step_order
  when 1 then 'age'
  when 2 then 'area'
  when 3 then 'motorcycle'
  when 4 then 'license'
  when 5 then 'shift'
  when 6 then 'id_document'
  when 7 then 'license_document'
end
where question_key is null and step_order between 1 and 7;

-- Upgrade only the untouched seed wording, preserving administrator edits.
update public.bot_questions
set question_text = 'أنهي منطقة مناسبة ليك للعمل؟ أكتوبر - التجمع - مدينتي - الشروق - الرحاب - العبور - مدينة نصر - النزهة - الظاهر - الهرم - الشيخ زايد'
where question_key = 'area' and question_text = 'ما المنطقة المناسبة للعمل؟';
update public.bot_questions
set question_text = 'ابعت صورة البطاقة بعد تغطية الرقم القومي بالكامل وأي رقم تعريفي حساس.'
where question_key = 'id_document' and question_text = 'ارسل صورة البطاقة';
update public.bot_questions
set question_text = 'ابعت صورة رخصة الموتوسيكل بعد تغطية رقم الرخصة وأي رقم تعريفي حساس.'
where question_key = 'license_document' and question_text = 'ارسل صورة رخصة الموتوسيكل';

create unique index if not exists bot_questions_key_unique
on public.bot_questions(question_key) where question_key is not null;

-- Prevent duplicate answers if delivery is retried after a partial failure.
create unique index if not exists bot_answers_applicant_question_unique
on public.bot_answers(applicant_id, question_id);

-- Staff may read the future dashboard's question/answer data, but only the
-- service-role webhook and SQL Editor may change the bot configuration.
revoke all on public.bot_questions, public.bot_answers, public.applicant_sessions from anon, authenticated;
grant select on public.bot_questions, public.bot_answers, public.applicant_sessions to authenticated;
drop policy if exists "recruiters read bot questions" on public.bot_questions;
create policy "recruiters read bot questions" on public.bot_questions
for select to authenticated using ((select public.is_recruiter()));
drop policy if exists "recruiters read bot answers" on public.bot_answers;
create policy "recruiters read bot answers" on public.bot_answers
for select to authenticated using ((select public.is_recruiter()));
drop policy if exists "recruiters read bot sessions" on public.applicant_sessions;
create policy "recruiters read bot sessions" on public.applicant_sessions
for select to authenticated using ((select public.is_recruiter()));

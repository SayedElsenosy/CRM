-- CRM Dashboard metrics support

create or replace view public.crm_dashboard_metrics with (security_invoker = true) as
select
  count(*) as total_applicants,
  count(*) filter (where created_at::date = current_date) as today_applicants,
  count(*) filter (where state = 'READY_FOR_RECRUITER') as ready_for_recruiter,
  count(*) filter (where state = 'NOT_ELIGIBLE') as rejected
from public.applicants;

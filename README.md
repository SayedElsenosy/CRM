# WhatsApp Recruitment Bot — MVP Starter

**تحديث v1.2:** ابدأ بملف `docs/UPDATE_FINAL_V1.2_AR.md`. مصدر اللوحة العاملة في `dashboard/`، والترحيلات الجديدة 016 و017.

Starter backend for a delivery-rider recruitment funnel using:

- Meta WhatsApp Cloud API
- Supabase Edge Functions (TypeScript / Deno)
- Supabase Postgres
- Private Supabase Storage for uploaded images
- Optional Gemini fallback for ambiguous free-text answers

## Current recruitment rules

- Age: 18–45 inclusive
- Allowed work areas: October, New Cairo/Tagamoa, Madinaty, El Shorouk, Rehab, Obour, Nasr City, Nozha, El Daher, Haram, Sheikh Zayed
- Motorcycle required
- Motorcycle license required
- 9-hour shift acceptance required
- Handoff happens after two document images arrive

## 1. Create Supabase project

Create a project, then run the SQL in:

`supabase/migrations/001_initial_schema.sql`

The migration creates:

- applicants
- messages
- documents
- a private `recruitment-documents` Storage bucket

## 2. Deploy the webhook function

With Node.js 20 or newer, open a terminal in this directory, install the local Supabase CLI, log in, link the project, then deploy:

```bash
npm install
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy whatsapp-webhook --no-verify-jwt
```

## 3. Set secrets

```bash
npx supabase secrets set WHATSAPP_VERIFY_TOKEN='YOUR_RANDOM_VERIFY_TOKEN'
npx supabase secrets set WHATSAPP_ACCESS_TOKEN='YOUR_META_ACCESS_TOKEN'
npx supabase secrets set WHATSAPP_PHONE_NUMBER_ID='YOUR_PHONE_NUMBER_ID'
npx supabase secrets set META_APP_SECRET='YOUR_META_APP_SECRET'
npx supabase secrets set WHATSAPP_GRAPH_VERSION='CURRENT_META_GRAPH_VERSION'
```

Optional Gemini fallback:

```bash
npx supabase secrets set GEMINI_API_KEY='YOUR_GEMINI_API_KEY'
npx supabase secrets set GEMINI_MODEL='gemini-2.5-flash-lite'
```

Do not send applicant document images, phone numbers, or full profiles to the AI provider. The code only sends the current state + the current text message when deterministic parsing fails.

## 4. Configure Meta webhook

Webhook callback URL:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/whatsapp-webhook
```

Use the exact same value you put in `WHATSAPP_VERIFY_TOKEN` as the Meta verify token.

Subscribe the WhatsApp Business Account to message events.

## 5. Test flow

Example:

```text
Applicant: عايز أقدم
Bot: أهلًا بك ... كام سنة؟
Applicant: 28
Bot: أنهي منطقة مناسبة ليك؟ ...
Applicant: مدينة نصر
Bot: هل عندك موتوسيكل؟
Applicant: نعم
Bot: هل عندك رخصة موتوسيكل سارية؟
Applicant: نعم
Bot: هل 9 ساعات مناسبة؟
Applicant: نعم
Bot: ابعت صورة البطاقة
Applicant: [image with sensitive ID number covered]
Bot: ابعت صورة رخصة الموتوسيكل بعد تغطية رقم الرخصة
Applicant: [image with sensitive license number covered]
Bot: تم الاستلام ... هحوّلك لمسؤول التوظيف
```

The applicant now has:

```text
state = READY_FOR_RECRUITER
ai_active = false
```

## Security / production notes

This is an MVP starter, not a complete production system. Before production:

1. Set `META_APP_SECRET` before connecting Meta. The webhook now rejects unsigned requests and returns 401 if the secret is missing.
2. Add recruiter authentication and RLS policies before building the dashboard.
3. Add document retention/deletion rules and access audit logs.
4. Add a durable inbox/queue with per-applicant ordering, processing status, and retries. The current background task acknowledges Meta before processing, so a crash or failed outgoing reply can leave a message incomplete; do not use with real applicants until this is addressed.
5. Add rate limiting and monitoring.
6. Never expose the Supabase service-role key to a browser/client.
7. Do not let an LLM make hiring eligibility decisions; keep those in deterministic rules.
8. Incoming photos are recorded by conversation position, not verified as authentic documents. A recruiter must inspect them. Follow Meta's prohibition on requesting complete personal identification numbers; ask applicants to cover these before sending.

## Next build milestone

Build the recruiter dashboard:

- KPI cards: New / Screening / Waiting Docs / Docs Received / Ready for Recruiter
- Applicant table
- Applicant detail + conversation history
- Secure signed links for document viewing
- Human handoff button/state
# Recruiter dashboard

The internal recruiter dashboard is backed by `supabase/migrations/002_recruiter_dashboard.sql`.
Read `docs/RECRUITER_DASHBOARD_AR.md` for the staff account, RLS and setup steps.
Dashboard review status and notes are separate from the WhatsApp conversation state.
# Dynamic questions update

To update the deployed WhatsApp webhook, read `docs/UPDATE_V2.2_AR.md` first.
The `003_dynamic_bot_flow.sql` migration was run previously; this corrected
package additionally requires `004_campaign_tracking.sql` and
`005_dynamic_flow_safety.sql` before publishing its Edge Function.
New applicants use questions ordered in the database; existing in-progress
applicants finish the original flow.

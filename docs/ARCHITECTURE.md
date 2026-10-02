# Architecture — MVP

```text
Facebook / Instagram Click-to-WhatsApp Ad
                  │
                  ▼
           WhatsApp user message
                  │
                  ▼
      Meta WhatsApp Cloud API webhook
                  │ HTTPS
                  ▼
      Supabase Edge Function (public webhook)
                  │
        ┌─────────┴──────────┐
        ▼                    ▼
Postgres applicant      Optional Gemini
state + messages        fallback parsing
        │
        ▼
Deterministic Rules Engine
(age 18-45, area list, motorcycle, license, 9h)
        │
        ▼
WhatsApp response through Cloud API
        │
        ▼
Applicant sends ID image + motorcycle-license image
        │
        ▼
Private Supabase Storage
        │
        ▼
READY_FOR_RECRUITER + AI OFF
```

## Principle

The LLM does **not** decide eligibility. It only helps interpret ambiguous Arabic replies. Eligibility is decided by deterministic code.

## State machine

NEW → WAITING_AGE → WAITING_AREA → WAITING_MOTORCYCLE → WAITING_LICENSE → WAITING_SHIFT → WAITING_ID_DOC → WAITING_LICENSE_DOC → READY_FOR_RECRUITER

Any mandatory failure → NOT_ELIGIBLE.

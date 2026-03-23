# DappaAi — PoC & Phase 1 Summary

**As at:** 2026-03-22

---

## Status at a Glance

| Phase | Scope | Status |
|-------|-------|--------|
| Phase 0 — PoCs | 11 deliverables across PoC 1 + PoC 2 | **COMPLETE** |
| Phase 1 — MVP | 21 features across 5 core areas | **COMPLETE** (20/21 — 1 deferred) |
| Infrastructure Migration | 4 sprints, 8 weeks | **NEXT** |

**Total timeline:** 24 weeks (8 PoC + 6 Phase 1 build + 8 migration + 2 UAT/launch)

---

## What Was Built

### PoC 1 — Scoring Engine (Weeks 1–4)

Proved that AlayaCare data can drive automated caregiver matching. Delivered a working scoring engine with 5 weighted dimensions (proximity, skills, availability, relationship history, compliance), validated against 32 shift scenarios. Produced formal documentation of API capabilities, limitations, workarounds, security posture, and integration effort.

**Key artefacts:** `src/services/scoring/` (11 files, 61 tests), 6 BA documents covering edge cases, workarounds, security, and production pathway.

### PoC 2 — LLM Reasoning Layer (Weeks 4–7)

Proved that an LLM can replicate human rostering decisions. Selected AWS Bedrock (Haiku 4.5) as the provider. Built a reasoning service with structured prompt engineering, 7 escalation criteria, and a confusion matrix evaluation framework tested against 32 human-baseline scenarios.

**Key artefacts:** `src/services/reasoning/` (reasoning service, evaluation framework, 32 baselines), formal PoC 2 deliverable document.

### Phase 1 MVP — Autonomous Shift Filling (Weeks 7–14)

Built the full autonomous rostering pipeline end-to-end:

- **Webhook processing** — Idempotent event receiver with M2M auth, dispatcher, debouncer, 7 event handlers
- **Workflow orchestrator** — 11-state machine (detected → completed/cancelled), urgency classification, data validation
- **Communication layer** — Mock SMS (Twilio stub) and email (SES stub), sequential + parallel cascade logic, escalation engine
- **Human-in-the-loop UI** — Operations dashboard, escalation console, audit trail, analytics dashboard, conversational chat interface (4 read + 3 write tools)
- **Learning system** — Outcome tracking, pattern recognition (always_declines, client_churn, etc.), acceptance feedback loop with 30-day decay

**Test coverage:** 554 tests across 65 files.

---

## What's Deferred

| Item | Reason | When |
|------|--------|------|
| AlayaCare app notifications (3.3) | Requires push notification API access | Phase 2 |
| Rate limit testing (R1.6) | Needs real AlayaCare sandbox | During migration |
| API response time testing (R3.4) | Needs real AlayaCare sandbox | During migration |
| Real SMS/email delivery | Needs Twilio/SES accounts | Sprint M3 |

---

## Next: Infrastructure Migration (Weeks 15–22)

Migrating from Supabase/Drizzle to **Xano** (CRUD, data storage) + **Upstash** (durable workflows, rate limiting) with real communication providers.

| Sprint | Weeks | Focus |
|--------|-------|-------|
| M1 | 15–16 | Xano foundation — tables, CRUD template, auth, rate limiters |
| M2 | 17–18 | Upstash Workflow — webhook pipeline, durable score→reason→cascade flow |
| M3 | 19–20 | Twilio SMS, AlayaCare write-back, coordinator actions, chat migration |
| M4 | 21–22 | Dashboard on Xano, old DB removal, production hardening |

**Then:** UAT with Dovida staff (Week 23) → Production launch (Week 24).

### External Dependencies Needed

- Xano paid plan (M1 Day 1)
- Upstash account — Redis + QStash (M1 Day 7)
- Twilio account + phone number (M3 mock, M4 real)
- AlayaCare sandbox/production credentials (M4)

---

## Outstanding BA Work

| Work Item | Priority | Effort |
|-----------|----------|--------|
| AlayaCare sandbox contract validation | HIGH | 2–3 days |
| UAT scenarios for Dovida staff | HIGH | 2–3 days |
| Email parsing rules (inbound care manager handover) | MEDIUM | 2 days |
| Daily/weekly report content spec | MEDIUM | 1 day |
| Rate limit characterisation | MEDIUM | 1 day |
| Multi-tenant requirements definition | LOW | 2–3 days |

---

## Success Criteria

### Already Met (PoCs)

- All critical AlayaCare read/write operations achievable via API
- Match scores calculated for 32 real shift scenarios (32/32 passed)
- LLM decisions match staff choices >=75% in straightforward scenarios
- LLM escalation accuracy >=85% with false positive rate <20%
- Reasoning explanations rated clear and trustworthy >=80%

### To Be Validated Post-Launch

| Metric | Target |
|--------|--------|
| Reduction in shift-filling phone calls | >=30% |
| Average time-to-fill (planned shifts) | <=20 minutes |
| First-contact acceptance rate | >=30% |

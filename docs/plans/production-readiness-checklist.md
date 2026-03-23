# Production Readiness Checklist — Phase 1 Autonomous Shift Filling

**Status:** Pre-launch
**Last Updated:** 2026-03-11

## Provider Cutover (Mock → Real)

### SMS (Twilio)
- [ ] Sign up for Twilio account
- [ ] Get dedicated phone number
- [ ] Implement `TwilioSMSProvider.send()` (stub exists in P1.3)
- [ ] Implement `TwilioSMSProvider.verifyWebhook()` for inbound SMS validation
- [ ] Configure inbound SMS webhook URL → `/api/v1/webhooks/sms`
- [ ] Implement two-phase inbound SMS pattern (M2M → intermediate table → user-scoped processing)
- [ ] Test real SMS send + receive with test phone number
- [ ] Set `SMS_ENABLED=true` in production environment

### Email (SES/SendGrid)
- [ ] Sign up for email provider (SES or SendGrid)
- [ ] Configure domain verification (SPF, DKIM, DMARC)
- [ ] Implement `SESEmailProvider.send()` (stub exists in P1.6)
- [ ] Test real email send with test address
- [ ] Set `EMAIL_ENABLED=true` in production environment

### AI/LLM (AWS Bedrock)
- [ ] Verify Bedrock inference profile active in production region
- [ ] Confirm `BEDROCK_MODEL_ARN` environment variable set
- [ ] Test LLM calls with production credentials

## Infrastructure

### AlayaCare Integration
- [ ] Swap `ALAYACARE_API_URL` from sandbox to production URL
- [ ] Verify M2M webhook authentication (`ALAYACARE_WEBHOOK_SECRET`)
- [ ] Confirm all webhook event types are registered in AlayaCare admin
- [ ] Test end-to-end: AlayaCare webhook → event dispatch → task creation

### Database
- [ ] Switch from `postgres` role (BYPASSRLS) to `mayfly_app` role (non-BYPASSRLS)
- [ ] Verify RLS policies enforced on all roster tables
- [ ] Run all migrations in production database
- [ ] Verify indexes on `roster_tasks.user_id`, `roster_tasks.visit_id`, `roster_tasks.status`

### Security
- [ ] Verify `ALAYACARE_WEBHOOK_SECRET` configured
- [ ] Verify `SMS_WEBHOOK_SECRET` configured (for Twilio signature validation)
- [ ] Verify `EMAIL_WEBHOOK_SECRET` configured (if email webhook needed)
- [ ] Confirm `/api/v1/dev/simulate-response` returns 404 in production (guard exists)
- [ ] Rate limiting on webhook routes (Vercel edge config or middleware)
- [ ] Review CORS settings for production domain

### Monitoring & Observability
- [ ] Set `LOG_LEVEL=info` in production
- [ ] Configure error alerting (task failures, external service errors)
- [ ] Set up SLA alerts on time-to-fill metric (target: ≤20 minutes for planned shifts)
- [ ] Dashboard for key metrics: fill rate, escalation rate, avg time-to-fill

## Environment Variables

```env
# Required for production
ALAYACARE_API_URL=https://api.alayacare.com/v1
ALAYACARE_WEBHOOK_SECRET=<secret>
SMS_ENABLED=true
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=<sid>
TWILIO_AUTH_TOKEN=<token>
TWILIO_PHONE_NUMBER=<phone>
EMAIL_ENABLED=true
EMAIL_PROVIDER=ses
BEDROCK_MODEL_ARN=<arn>
LOG_LEVEL=info
NODE_ENV=production
```

## Validation

### Pre-Launch Tests
- [ ] Full E2E workflow: webhook → task → score → reason → contact → accept → assign
- [ ] Escalation workflow: all contacts decline → escalates to coordinator
- [ ] Cancellation workflow: visit cancelled → task cancelled → contacted caregiver notified
- [ ] Analytics dashboard loads with real data
- [ ] Chat interface queries work end-to-end
- [ ] Chat write actions (create task, assign, cancel) work with confirmation flow
- [ ] Daily metrics materialisation runs correctly

### Performance Validation
- [ ] Scoring pipeline: <500ms with 150+ candidates
- [ ] Full pipeline (scoring + reasoning): <5s
- [ ] Dashboard query with 1000+ tasks: <200ms
- [ ] Load test with production-scale data

## Go-Live Sequence

1. Deploy code with `SMS_ENABLED=false`, `EMAIL_ENABLED=false`
2. Verify AlayaCare webhook connectivity
3. Enable email (`EMAIL_ENABLED=true`)
4. Test email delivery end-to-end
5. Enable SMS (`SMS_ENABLED=true`)
6. Test SMS delivery and inbound response
7. Monitor first 24 hours — check error rates, escalation rates
8. Review analytics dashboard after first week

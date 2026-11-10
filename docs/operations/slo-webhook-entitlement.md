# Webhook to entitlement SLO burning

Alert: `SelectaSloBurn_webhook_entitlement_latency_page / _ticket` (`infra/observability/`). Status: written before beta; refine after the first game day.

## What it means

More than 5% of Stripe webhooks take longer than 60 s to change the customer's entitlement.

## First checks

1. Is billing safe mode engaged? Events are held on purpose then.
2. Is the maintenance leader running? It drains stored Stripe events ([maintenance service down](maintenance-service-down.md)).
3. Stripe dashboard: webhook delivery failures or retries; signature errors in traces for `POST /api/webhooks/stripe`.

## Safe actions

- [Billing safe mode](emergency/billing-safe-mode.md) if events are being applied wrongly.
- Run Stripe reconciliation (`selecta billing-maintenance`) once the cause is fixed.
- Restart the maintenance service if its leader is stuck.

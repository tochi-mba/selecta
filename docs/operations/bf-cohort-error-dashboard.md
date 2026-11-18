# Browser-first Cloud cohort error dashboard

This is the operational definition of the error-rate view required before ADR-0467 step 4. The
provisioned dashboard is
[`local_first_cohort_error_rate.json`](../../infra/observability/generated/dashboards/local_first_cohort_error_rate.json).

## Signal

`selecta_api_requests_total{cohort,status_class}` is emitted by the Cloud API middleware for each
`/api/` response. `cohort` is the live account decision for `cloud.local_first`: `browser_first`
or `hosted`. `status_class` is `2xx`, `3xx`, `4xx` or `5xx`. Requests without an authenticated
account are `unknown` and do not enter the comparison. No account id, workspace id, URL, query
string, body or token is attached to this metric.

The dashboard shows the 5xx fraction and total request rate for each cohort, plus a separate 4xx
rate. The 4xx panel matters because a broken flag or permission boundary can hurt a cohort without
producing a server error. The metric is an aggregate signal; it does not replace tracing, support
reports or the release gates in ADR-0466.

## Deployment and readiness

1. Provision the JSON dashboard with the other generated dashboards.
2. Enable `cloud.metrics`, install the `observability` extra and set
   `OTEL_EXPORTER_OTLP_ENDPOINT` on the API deployment.
3. Confirm that Prometheus receives both `hosted` and `browser_first` samples and that both
   panels have a non-zero request denominator. The dashboard can be provisioned before the Labs
   cohort exists; it is not live for rollout until both real cohorts have data.
4. Review the 5xx and 4xx rates against traffic volume and the hosted baseline. Record the
   dashboard link and review in the step ledger. Only the owner records `[dashboards-green]` in a
   `cloud.local_first` rule change after that review.

The percentage readiness route refuses the step unless the dashboard definition exists, metrics
are enabled and an OTLP endpoint is configured. Its refusal plus the absent owner marker keeps a
configured-but-empty dashboard from being mistaken for evidence. The owner review remains a
human release decision; code does not infer that a graph is healthy.

## Limits

The counter is process-local before export and follows the configured OpenTelemetry export
interval. Allow for scrape delay after deployment or a restart. A missing cohort series means
there is not yet traffic for that cohort; it is not a zero error rate. Do not advance percentage
rollout while either cohort has no request denominator.

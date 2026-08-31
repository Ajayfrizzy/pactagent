# Service indicators and provisional objectives

These objectives are initial engineering thresholds, not contractual commitments. Review them after 30 days of representative staging and production traffic.

| Capability | Indicator | Provisional objective | Window |
| --- | --- | ---: | ---: |
| API availability | Non-5xx responses / all responses | 99.9% | 30 days |
| API latency | Requests completed within 1 second | 95% | 30 days |
| Durable jobs | Runnable jobs started within 5 minutes | 99% | 7 days |
| Webhook delivery | Delivered within configured attempts | 99% | 7 days |
| Worker continuity | Fresh infrastructure worker heartbeat within 60 seconds | 99.9% | 30 days |

Page immediately for worker loss, database saturation, a required provider circuit opening, or a sustained API error budget burn. Ticket non-urgent webhook/provider degradation. Dead letters always require ownership and disposition.

Prometheus rules in `observability/prometheus/alerts.yaml` encode the initial thresholds. Grafana dashboards in `observability/dashboards` provide API, worker, queue, webhook, database, and provider views. Every alert must link to an owner and runbook in the external alert manager before production notification routing is enabled.

Metric labels are restricted to bounded operational dimensions. Resource, tenant, request, trace, address, and URL identifiers belong in redacted structured logs and traces, never Prometheus labels.

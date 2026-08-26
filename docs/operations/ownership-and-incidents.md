# Ownership and incident severity

| Area | Primary owner | Responsibilities |
| --- | --- | --- |
| API and authentication | API owner (`@oluwaseun`) | Routes, auth, rate limits, compatibility |
| Webhook worker and settlement boundary | Settlement owner (`@oluwaseun`) | Webhook jobs, CKB readiness, and Phase 2 rail ownership |
| PostgreSQL and migrations | Data owner (`@oluwaseun`) | Schema, backups, restore tests, query plans |
| Security and secrets | Security owner (`@oluwaseun`) | Threat model, key rotation, incident response |
| Web application | Web owner (`@oluwaseun`) | User flows and API integration |

| Severity | Definition | Initial response target |
| --- | --- | --- |
| SEV-1 | Confirmed key compromise, tenant escape, incorrect settlement, or broad outage | 15 minutes; stop unsafe settlement and page all owners |
| SEV-2 | Material degradation, stuck settlement queue, or single-tenant data loss risk | 30 minutes; assign incident lead |
| SEV-3 | Limited feature failure with a workaround and no security or funds risk | 4 business hours |
| SEV-4 | Cosmetic, documentation, or low-impact operational defect | Next planning cycle |

The incident lead records timeline, impact, decisions, and evidence. Preserve audit logs and provider request IDs. Rotate exposed credentials, notify affected tenants through the approved channel, and complete a blameless review for SEV-1/2.

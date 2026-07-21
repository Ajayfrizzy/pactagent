import { prisma } from '../db';
import { log } from '../common/observability/logger';

type TenantViolation = {
  relation: string;
  childId: string;
  childAppId: string | null;
  parentId: string;
  parentAppId: string | null;
};

const checks = [
  ['Milestone.agreementId', 'Milestone', 'agreementId', 'Agreement'],
  ['Proof.agreementId', 'Proof', 'agreementId', 'Agreement'],
  ['Proof.milestoneId', 'Proof', 'milestoneId', 'Milestone'],
  ['Review.agreementId', 'Review', 'agreementId', 'Agreement'],
  ['Review.milestoneId', 'Review', 'milestoneId', 'Milestone'],
  ['Review.proofSubmissionId', 'Review', 'proofSubmissionId', 'Proof'],
  ['Escrow.agreementId', 'Escrow', 'agreementId', 'Agreement'],
  ['Escrow.milestoneId', 'Escrow', 'milestoneId', 'Milestone'],
  ['Transaction.agreementId', 'Transaction', 'agreementId', 'Agreement'],
  ['Transaction.milestoneId', 'Transaction', 'milestoneId', 'Milestone'],
  ['Transaction.escrowId', 'Transaction', 'escrowId', 'Escrow'],
  ['Dispute.agreementId', 'Dispute', 'agreementId', 'Agreement'],
  ['Dispute.milestoneId', 'Dispute', 'milestoneId', 'Milestone'],
  ['Event.agreementId', 'Event', 'agreementId', 'Agreement'],
  ['Event.milestoneId', 'Event', 'milestoneId', 'Milestone'],
  ['Event.escrowId', 'Event', 'escrowId', 'Escrow'],
  ['Event.proofSubmissionId', 'Event', 'proofSubmissionId', 'Proof'],
  ['Event.disputeId', 'Event', 'disputeId', 'Dispute'],
  ['WebhookDelivery.endpointId', 'WebhookDelivery', 'endpointId', 'WebhookEndpoint'],
  ['WebhookDelivery.eventId', 'WebhookDelivery', 'eventId', 'Event'],
  ['WebhookDelivery.agreementId', 'WebhookDelivery', 'agreementId', 'Agreement'],
  ['AuditLog.agreementId', 'AuditLog', 'agreementId', 'Agreement'],
] as const;

function identifier(value: string) {
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

export async function auditTenantIntegrity() {
  const [database] = await prisma.$queryRaw<Array<{ agreementTable: string | null }>>`
    SELECT to_regclass('"Agreement"')::text AS "agreementTable"
  `;
  if (!database?.agreementTable) return [];

  const violations: TenantViolation[] = [];
  for (const [relation, childTable, childColumn, parentTable] of checks) {
    const rows = await prisma.$queryRawUnsafe<Array<Omit<TenantViolation, 'relation'>>>(`
      SELECT child.id AS "childId", child."appId" AS "childAppId",
             parent.id AS "parentId", parent."appId" AS "parentAppId"
      FROM ${identifier(childTable)} child
      JOIN ${identifier(parentTable)} parent ON parent.id = child.${identifier(childColumn)}
      WHERE child.${identifier(childColumn)} IS NOT NULL
        AND child."appId" IS NOT NULL
        AND child."appId" IS DISTINCT FROM parent."appId"
      ORDER BY child.id
      LIMIT 100
    `);
    violations.push(...rows.map((row) => ({ relation, ...row })));
  }
  return violations;
}

async function main() {
  const violations = await auditTenantIntegrity();
  if (violations.length > 0) {
    log('error', 'tenant.integrity.audit.failed', {
      violationCount: violations.length,
      violations,
    });
    process.exitCode = 1;
    return;
  }
  log('info', 'tenant.integrity.audit.passed', { checkedRelations: checks.length });
}

if (process.argv[1]?.endsWith('auditTenantIntegrity.ts') || process.argv[1]?.endsWith('auditTenantIntegrity.js')) {
  main().finally(() => prisma.$disconnect());
}

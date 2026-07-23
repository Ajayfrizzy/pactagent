type MilestoneRecord = {
  id: string;
  appId: string | null;
  agreementId: string;
  externalReferenceId: string | null;
  title: string;
  description: string;
  amount: string;
  currency: string | null;
  sortOrder: number;
  status: string;
  dueDate: Date | null;
  reviewStartedAt: Date | null;
  reviewDeadlineAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function serializeMilestone(milestone: MilestoneRecord) {
  return {
    id: milestone.id,
    appId: milestone.appId,
    agreementId: milestone.agreementId,
    externalReferenceId: milestone.externalReferenceId,
    title: milestone.title,
    description: milestone.description,
    amount: milestone.amount,
    currency: milestone.currency ?? 'CKB',
    order: milestone.sortOrder,
    status: milestone.status,
    dueDate: milestone.dueDate?.toISOString() ?? null,
    reviewStartedAt: milestone.reviewStartedAt?.toISOString() ?? null,
    reviewDeadlineAt: milestone.reviewDeadlineAt?.toISOString() ?? null,
    createdAt: milestone.createdAt.toISOString(),
    updatedAt: milestone.updatedAt.toISOString(),
  };
}

import { serializeTransaction } from './transaction.model';
import { tenantContext } from '../../common/tenancy/tenant-context';
import * as transactionRepository from './transaction.repository';

export async function listAppTransactions(appId: string, params: {
  escrowId?: string;
  agreementId?: string;
  limit: number;
  cursor?: string;
}) {
  const transactions = await transactionRepository.listTransactionsForApp(tenantContext(appId), params);
  const hasMore = transactions.length > params.limit;
  const data = transactions.slice(0, params.limit);

  return {
    data: data.map(serializeTransaction),
    pagination: {
      limit: params.limit,
      cursor: hasMore ? data[data.length - 1]?.id ?? null : null,
    },
  };
}

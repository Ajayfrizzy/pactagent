import { AppError } from '../../common/errors/app-error';
import { ckbBroadcastFailures, ckbRpcDuration, ckbRpcErrors } from '../../common/observability/metrics';

type RpcFetch = typeof fetch;

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
};

class CkbRpcClient {
  private requestId = 0;

  constructor(
    private readonly url: string,
    private readonly endpoint: 'node' | 'indexer',
    private readonly fetchImpl: RpcFetch = fetch,
  ) {}

  protected async request<T>(method: string, params: unknown[] = []): Promise<T> {
    const stopTimer = ckbRpcDuration.startTimer({ endpoint: this.endpoint, method });
    try {
      const response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++this.requestId, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as JsonRpcResponse<T>;
      if (payload.error || payload.result === undefined) {
        throw new Error(payload.error?.message || 'RPC response did not contain a result.');
      }
      stopTimer({ outcome: 'success' });
      return payload.result;
    } catch (error) {
      stopTimer({ outcome: 'error' });
      ckbRpcErrors.inc({ endpoint: this.endpoint, method });
      throw new AppError({
        statusCode: 503,
        type: 'internal_error',
        code: 'ckb_provider_unavailable',
        message: `CKB ${this.endpoint} RPC ${method} is unavailable.`,
        details: error instanceof Error ? { name: error.name, message: error.message } : undefined,
      });
    }
  }
}

export type CkbRpcScript = {
  code_hash: string;
  hash_type: 'data' | 'type' | 'data1' | 'data2';
  args: string;
};

export type CkbRpcTransaction = {
  version: string;
  cell_deps: Array<{ out_point: { tx_hash: string; index: string }; dep_type: 'code' | 'dep_group' }>;
  header_deps: string[];
  inputs: Array<{ previous_output: { tx_hash: string; index: string }; since: string }>;
  outputs: Array<{ capacity: string; lock: CkbRpcScript; type?: CkbRpcScript | null }>;
  outputs_data: string[];
  witnesses: string[];
};

export type CkbTransactionResponse = {
  transaction: CkbRpcTransaction | null;
  tx_status: {
    status: 'pending' | 'proposed' | 'committed' | 'rejected' | 'unknown';
    block_hash?: string;
    block_number?: string;
    reason?: string;
  };
};

export class CkbNodeRpcClient extends CkbRpcClient {
  constructor(url: string, fetchImpl?: RpcFetch) {
    super(url, 'node', fetchImpl);
  }

  getTransaction(txHash: string) {
    return this.request<CkbTransactionResponse | null>('get_transaction', [txHash]);
  }

  getTipHeader() {
    return this.request<{ hash: string; number: string }>('get_tip_header');
  }

  getLiveCell(txHash: string, index: number) {
    return this.request<unknown>('get_live_cell', [{ tx_hash: txHash, index: `0x${index.toString(16)}` }, true]);
  }

  async sendTransaction(transaction: CkbRpcTransaction) {
    try {
      return await this.request<string>('send_transaction', [transaction, 'passthrough']);
    } catch (error) {
      ckbBroadcastFailures.inc({ outcome: 'ambiguous' });
      throw error;
    }
  }
}

export type CkbIndexerCell = {
  output: { capacity: string; lock: CkbRpcScript; type?: CkbRpcScript | null };
  output_data: string;
  out_point: { tx_hash: string; index: string };
  block_number: string;
  tx_index: string;
};

export class CkbIndexerRpcClient extends CkbRpcClient {
  constructor(url: string, fetchImpl?: RpcFetch) {
    super(url, 'indexer', fetchImpl);
  }

  getTip() {
    return this.request<{ block_hash: string; block_number: string }>('get_indexer_tip');
  }

  getCells(lock: CkbRpcScript, limit = 100, cursor?: string) {
    return this.request<{ objects: CkbIndexerCell[]; last_cursor: string }>('get_cells', [
      { script: lock, script_type: 'lock', script_search_mode: 'exact' },
      'asc',
      `0x${limit.toString(16)}`,
      ...(cursor ? [cursor] : []),
    ]);
  }

  getTransactions(lock: CkbRpcScript, limit = 100, cursor?: string) {
    return this.request<unknown>('get_transactions', [
      { script: lock, script_type: 'lock', script_search_mode: 'exact', group_by_transaction: true },
      'desc',
      `0x${limit.toString(16)}`,
      ...(cursor ? [cursor] : []),
    ]);
  }
}

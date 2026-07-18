import {
  Address,
  ClientPublicMainnet,
  ClientPublicTestnet,
  SignerCkbPrivateKey,
  Transaction,
} from '@ckb-ccc/core';
import { config, requireConfig } from '../config';
import { assertProviderResponse, executeProviderRequest } from '../common/resilience/provider';

export interface TreasurySignerProvider {
  getAddress(): Promise<string>;
  sendTransfer(toAddress: string, amount: string): Promise<string>;
}

function client() {
  return config.ckbNetwork === 'mainnet'
    ? new ClientPublicMainnet({ url: config.ckbNodeUrl })
    : new ClientPublicTestnet({ url: config.ckbNodeUrl });
}

class LocalTreasurySignerProvider implements TreasurySignerProvider {
  private signer() {
    return new SignerCkbPrivateKey(
      client(),
      requireConfig(config.treasuryPrivateKey, 'TREASURY_CKB_PRIVATE_KEY or TREASURY_CKB_PRIVATE_KEY_FILE'),
    );
  }

  async getAddress() {
    return String(await this.signer().getRecommendedAddress());
  }

  async sendTransfer(toAddress: string, amount: string) {
    const signer = this.signer();
    const transaction = Transaction.from({});
    const destination = await Address.fromString(toAddress, signer.client);
    transaction.addOutput({ lock: destination.script, capacity: BigInt(amount) });
    await transaction.completeFeeBy(signer, BigInt(config.defaultCkbFeeRate));
    return signer.sendTransaction(transaction);
  }
}

class ManagedTreasurySignerProvider implements TreasurySignerProvider {
  async getAddress() {
    return requireConfig(config.treasuryAddress, 'TREASURY_CKB_ADDRESS');
  }

  async sendTransfer(toAddress: string, amount: string) {
    const baseUrl = requireConfig(config.treasurySignerUrl, 'TREASURY_SIGNER_URL');
    const token = requireConfig(config.treasurySignerToken, 'TREASURY_SIGNER_TOKEN or TREASURY_SIGNER_TOKEN_FILE');
    const response = await executeProviderRequest({
      provider: 'treasury_signer', operation: 'transfer', timeoutMs: 30_000, maxAttempts: 1, concurrency: 2,
      run: async ({ signal, requestId }) => {
        const result = await fetch(new URL('/v1/ckb/transfers', baseUrl), {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-request-id': requestId },
          body: JSON.stringify({ network: config.ckbNetwork, toAddress, amount, feeRate: config.defaultCkbFeeRate }),
          signal,
        });
        assertProviderResponse(result, 'treasury_signer', requestId);
        return result;
      },
    });
    const result = await response.json() as { txHash?: string };
    if (!result.txHash || !/^0x[a-fA-F0-9]{64}$/.test(result.txHash)) {
      throw new Error('Managed treasury signer returned an invalid transaction hash.');
    }
    return result.txHash;
  }
}

export function getTreasurySignerProvider(): TreasurySignerProvider {
  return config.treasurySignerProvider === 'managed'
    ? new ManagedTreasurySignerProvider()
    : new LocalTreasurySignerProvider();
}

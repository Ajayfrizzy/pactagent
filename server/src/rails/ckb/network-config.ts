import { config, validateCkbRailConfig } from '../../config';

export type CkbRailConfig = {
  enabled: boolean;
  network: 'testnet' | 'mainnet';
  nodeUrl: string;
  indexerUrl: string;
  contract: {
    codeHash: string;
    hashType: 'data' | 'type' | 'data1' | 'data2';
    deploymentTxHash: string;
    outputIndex: number;
    depType: 'code' | 'depGroup';
    version: number;
  };
  confirmations: number;
  feeRate: bigint;
};

export function getCkbRailConfig(): CkbRailConfig {
  validateCkbRailConfig();
  return {
    enabled: config.ckbRailEnabled,
    network: config.ckbNetwork,
    nodeUrl: config.ckbNodeUrl,
    indexerUrl: config.ckbIndexerUrl,
    contract: {
      codeHash: config.ckbContractCodeHash,
      hashType: config.ckbContractHashType as CkbRailConfig['contract']['hashType'],
      deploymentTxHash: config.ckbContractDeploymentTxHash,
      outputIndex: config.ckbContractOutputIndex,
      depType: config.ckbContractDepType as CkbRailConfig['contract']['depType'],
      version: 1,
    },
    confirmations: config.ckbConfirmations,
    feeRate: BigInt(config.defaultCkbFeeRate),
  };
}

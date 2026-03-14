'use client';

import { CSSProperties, ReactNode, useMemo } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { getCkbClient } from '@/lib/ckb';

export function CccProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => getCkbClient(), []);
  const network = process.env.NEXT_PUBLIC_CKB_NETWORK || 'testnet';

  return (
    <ccc.Provider
      defaultClient={client}
      preferredNetworks={[
        {
          signerType: ccc.SignerType.CKB,
          addressPrefix: network === 'mainnet' ? 'ckb' : 'ckt',
          network,
        },
      ]}
      connectorProps={{
        style: {
          '--background': '#0f172a',
          '--divider': '#334155',
          '--btn-primary': '#1e293b',
          '--btn-primary-hover': '#334155',
          '--btn-secondary': '#172033',
          '--btn-secondary-hover': '#273449',
          '--icon-primary': '#f8fafc',
          '--icon-secondary': '#94a3b8',
          color: '#f8fafc',
        } as CSSProperties,
      }}
    >
      {children}
    </ccc.Provider>
  );
}

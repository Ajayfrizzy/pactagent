'use client';

import { useEffect, useRef, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { fetchAuthChallenge, verifyWalletAuth } from '@/lib/api';
import { useStore } from '@/lib/store';
import { LinkIcon } from './Icons';

export function WalletConnect() {
  const { open, disconnect } = ccc.useCcc();
  const signer = ccc.useSigner();
  const {
    walletAddress,
    authStatus,
    authError,
    authToken,
    setWalletSession,
    setAuthStatus,
    clearWalletSession,
  } = useStore((state) => ({
    walletAddress: state.walletAddress,
    authStatus: state.authStatus,
    authError: state.authError,
    authToken: state.authToken,
    setWalletSession: state.setWalletSession,
    setAuthStatus: state.setAuthStatus,
    clearWalletSession: state.clearWalletSession,
  }));
  const [working, setWorking] = useState(false);
  const authenticatedAddressRef = useRef<string | null>(null);

  useEffect(() => {
    const activeSigner = signer;

    if (!activeSigner) {
      authenticatedAddressRef.current = null;
      return;
    }

    let cancelled = false;

    async function authenticateWithBackend() {
      if (!activeSigner) {
        return;
      }

      try {
        setAuthStatus('authenticating');
        const address = await activeSigner.getRecommendedAddress();

        if (
          authToken &&
          walletAddress === address &&
          authenticatedAddressRef.current === address
        ) {
          setAuthStatus('authenticated');
          return;
        }

        await activeSigner.connect();
        const challenge = await fetchAuthChallenge(address);
        const signature = await activeSigner.signMessage(challenge.message);
        const session = await verifyWalletAuth({
          address,
          message: challenge.message,
          signature,
        });

        if (cancelled) {
          return;
        }

        authenticatedAddressRef.current = address;
        setWalletSession({
          walletAddress: session.address,
          authToken: session.token,
          authExpiresAt: session.expiresAt,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }
        clearWalletSession();
        setAuthStatus(
          'error',
          error instanceof Error ? error.message : 'Wallet authentication failed'
        );
      }
    }

    void authenticateWithBackend();

    return () => {
      cancelled = true;
    };
  }, [authToken, clearWalletSession, setAuthStatus, setWalletSession, signer, walletAddress]);

  async function handleConnect() {
    setWorking(true);
    try {
      open();
    } finally {
      setWorking(false);
    }
  }

  async function handleDisconnect() {
    setWorking(true);
    try {
      await disconnect();
    } finally {
      authenticatedAddressRef.current = null;
      clearWalletSession();
      setWorking(false);
    }
  }

  if (walletAddress && authStatus === 'authenticated') {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-agent-card border border-agent-border rounded-lg px-3 py-1.5">
          <div className="w-2 h-2 rounded-full bg-green-400" />
          <span className="text-xs font-mono text-gray-300">
            {walletAddress.slice(0, 12)}...{walletAddress.slice(-8)}
          </span>
        </div>
        <button
          onClick={handleDisconnect}
          disabled={working}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        onClick={handleConnect}
        disabled={working || authStatus === 'authenticating'}
        className="flex items-center gap-2 bg-agent-accent hover:bg-blue-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
      >
        {working || authStatus === 'authenticating' ? (
          <>
            <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            Connecting...
          </>
        ) : (
          <>
            <LinkIcon className="w-4 h-4" />
            Connect CKB Wallet
          </>
        )}
      </button>
      {authError && <span className="text-[11px] text-red-300">{authError}</span>}
    </div>
  );
}

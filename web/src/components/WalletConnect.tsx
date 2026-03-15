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
  const [connectedAddress, setConnectedAddress] = useState<string | null>(walletAddress);
  const authenticatedAddressRef = useRef<string | null>(null);
  const manualConnectRequestedRef = useRef(false);

  const displayAddress = walletAddress || connectedAddress;
  const hasAuthenticatedSession = Boolean(authToken && walletAddress);

  useEffect(() => {
    if (hasAuthenticatedSession && authStatus !== 'authenticated') {
      setAuthStatus('authenticated');
    }
  }, [authStatus, hasAuthenticatedSession, setAuthStatus]);

  useEffect(() => {
    const activeSigner = signer;

    if (!activeSigner) {
      if (!walletAddress) {
        setConnectedAddress(null);
      }
      authenticatedAddressRef.current = null;
      if (!hasAuthenticatedSession) {
        setWorking(false);
      }
      return;
    }

    let cancelled = false;

    async function hydrateConnectedAddress() {
      const currentSigner = activeSigner;
      if (!currentSigner) {
        return;
      }

      try {
        const address = await currentSigner.getRecommendedAddress();
        if (!cancelled) {
          setConnectedAddress(address);
        }
      } catch {
        // Ignore passive signer hydration errors.
      }
    }

    async function authenticateWithBackend() {
      const currentSigner = activeSigner;
      if (!currentSigner) {
        return;
      }

      if (!manualConnectRequestedRef.current && !authToken) {
        return;
      }

      try {
        setAuthStatus('authenticating');
        const address = await currentSigner.getRecommendedAddress();
        if (!cancelled) {
          setConnectedAddress(address);
        }

        if (authToken && walletAddress === address) {
          authenticatedAddressRef.current = address;
          setAuthStatus('authenticated');
          return;
        }

        if (manualConnectRequestedRef.current) {
          await currentSigner.connect();
        }

        const challenge = await fetchAuthChallenge(address);
        const signature = await currentSigner.signMessage(challenge.message);
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
      } finally {
        manualConnectRequestedRef.current = false;
        if (!cancelled) {
          setWorking(false);
        }
      }
    }

    void hydrateConnectedAddress();
    void authenticateWithBackend();

    return () => {
      cancelled = true;
    };
  }, [
    authStatus,
    authToken,
    clearWalletSession,
    hasAuthenticatedSession,
    setAuthStatus,
    setWalletSession,
    signer,
    walletAddress,
  ]);

  async function handleConnect() {
    setWorking(true);
    manualConnectRequestedRef.current = true;
    try {
      await open();
    } catch (error) {
      manualConnectRequestedRef.current = false;
      setWorking(false);
      setAuthStatus('error', error instanceof Error ? error.message : 'Wallet connection failed');
    }
  }

  async function handleDisconnect() {
    setWorking(true);
    try {
      await disconnect();
    } finally {
      manualConnectRequestedRef.current = false;
      authenticatedAddressRef.current = null;
      setConnectedAddress(null);
      clearWalletSession();
      setWorking(false);
    }
  }

  if (displayAddress) {
    return (
      <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-agent-border bg-agent-card px-3 py-2 sm:py-1.5">
          <div
            className={`h-2 w-2 shrink-0 rounded-full ${hasAuthenticatedSession ? 'bg-green-400' : 'bg-sky-400'}`}
          />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-mono text-gray-300">
              {displayAddress.slice(0, 12)}...{displayAddress.slice(-8)}
            </span>
            <span className="text-[10px] text-gray-500">
              {hasAuthenticatedSession ? 'Connected' : 'Wallet connected'}
            </span>
          </div>
        </div>
        <button
          onClick={handleDisconnect}
          disabled={working}
          className="self-start text-xs text-gray-500 transition-colors hover:text-gray-300 disabled:opacity-50 sm:self-auto"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-start gap-1.5">
      <button
        onClick={handleConnect}
        disabled={working || authStatus === 'authenticating'}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-agent-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-50 sm:w-auto"
      >
        {working || authStatus === 'authenticating' ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Connecting...
          </>
        ) : (
          <>
            <LinkIcon className="h-4 w-4" />
            Connect Wallet
          </>
        )}
      </button>
      {authError && <span className="text-[11px] text-red-300">{authError}</span>}
    </div>
  );
}

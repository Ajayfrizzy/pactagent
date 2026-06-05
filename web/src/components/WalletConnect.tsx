'use client';

import { useEffect, useRef, useState } from 'react';
import { ccc } from '@ckb-ccc/connector-react';
import { fetchAuthChallenge, fetchCurrentSession, verifyWalletAuth } from '@/lib/api';
import { useStore } from '@/lib/store';
import { LinkIcon } from './Icons';

type PersistedCccConnection = {
  signerName?: string;
  walletName?: string;
};

type SignerWithConnectionState = ccc.Signer & {
  isConnected?: () => Promise<boolean>;
};

type CccConnectorElement = HTMLElement & {
  walletName?: string;
  signerName?: string;
  wallet?: ccc.Wallet;
  signer?: ccc.SignerInfo;
  signersControllerInner?: {
    wallets?: Array<ccc.Wallet & { signers: ccc.SignerInfo[] }>;
  };
  refreshSigner?: () => void | Promise<void>;
  requestUpdate?: () => void;
};

export function WalletConnect({ compact = false }: { compact?: boolean }) {
  const { open, disconnect, wallet, signerInfo } = ccc.useCcc();
  const signer = ccc.useSigner();
  const {
    walletAddress,
    isAdmin,
    authStatus,
    authError,
    authToken,
    setWalletSession,
    setAuthStatus,
    clearWalletSession,
  } = useStore((state) => ({
    walletAddress: state.walletAddress,
    isAdmin: state.isAdmin,
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
  const autoReconnectAttemptedRef = useRef<string | null>(null);
  const authInFlightRef = useRef(false);

  const displayAddress = walletAddress || connectedAddress;
  const hasAuthenticatedSession = Boolean(authToken && walletAddress);
  const hasLiveSigner = Boolean(signer);
  const needsAuthentication = Boolean(displayAddress && !hasAuthenticatedSession);
  const signerTypeLabel = signerInfo?.signer.type || null;
  const walletSummary = [wallet?.name, signerTypeLabel].filter(Boolean).join(' - ');
  const connectionLabel = hasAuthenticatedSession
    ? hasLiveSigner
      ? 'Ready to use'
      : 'Wallet needs reconnecting'
    : hasLiveSigner
      ? authStatus === 'error'
        ? 'Sign-in needs attention'
        : 'Approve wallet sign-in'
      : 'Reconnect wallet';
  const statusDotClass = hasAuthenticatedSession
    ? hasLiveSigner
      ? 'bg-green-400'
      : 'bg-yellow-400'
    : hasLiveSigner
      ? authStatus === 'error'
        ? 'bg-red-400'
        : 'bg-amber-400'
      : 'bg-slate-500';
  const readinessPills = [
    { label: 'Wallet linked', active: Boolean(displayAddress) },
    { label: 'Session signed', active: hasAuthenticatedSession },
    { label: 'Signer ready', active: hasAuthenticatedSession && hasLiveSigner },
  ];

  function formatAuthError(error: unknown) {
    const fallback = 'Wallet sign-in failed.';
    const message = error instanceof Error ? error.message : String(error || fallback);
    const normalized = message.toLowerCase();

    if (
      normalized.includes('rejected')
      || normalized.includes('denied')
      || normalized.includes('cancelled')
      || normalized.includes('canceled')
      || normalized.includes('declined')
    ) {
      return 'Your wallet connected, but sign-in was not completed. Try again or reconnect.';
    }

    return message || fallback;
  }

  async function authenticateSigner(currentSigner: ccc.Signer, options?: { force?: boolean }) {
    if (authInFlightRef.current) {
      return;
    }

    if (!options?.force && !manualConnectRequestedRef.current && !authToken) {
      return;
    }

    authInFlightRef.current = true;
    setWorking(true);

    try {
      setAuthStatus('authenticating');
      const address = await currentSigner.getRecommendedAddress();
      setConnectedAddress(address);

      if (authToken && walletAddress === address) {
        authenticatedAddressRef.current = address;
        setAuthStatus('authenticated');
        return;
      }

      const signerWithConnectionState = currentSigner as SignerWithConnectionState;
      const isConnected = signerWithConnectionState.isConnected
        ? await signerWithConnectionState.isConnected().catch(() => true)
        : true;

      if (manualConnectRequestedRef.current && !isConnected) {
        await currentSigner.connect();
      }

      const challenge = await fetchAuthChallenge(address);
      const signature = await currentSigner.signMessage(challenge.message);
      const session = await verifyWalletAuth({
        address,
        message: challenge.message,
        signature,
      });

        authenticatedAddressRef.current = address;
        setWalletSession({
          walletAddress: session.address,
          authToken: session.token,
          authExpiresAt: session.expiresAt,
          isAdmin: session.isAdmin,
        });
    } catch (error) {
      clearWalletSession();
      setAuthStatus('error', formatAuthError(error));
    } finally {
      authInFlightRef.current = false;
      manualConnectRequestedRef.current = false;
      setWorking(false);
    }
  }

  useEffect(() => {
    if (hasAuthenticatedSession && authStatus !== 'authenticated') {
      setAuthStatus('authenticated');
    }
  }, [authStatus, hasAuthenticatedSession, setAuthStatus]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateExistingSession() {
      if (!authToken || !walletAddress) {
        return;
      }

      try {
        const session = await fetchCurrentSession();
        if (cancelled) {
          return;
        }

        setWalletSession({
          walletAddress: session.address,
          authToken,
          authExpiresAt: new Date(session.expiresAt * 1000).toISOString(),
          isAdmin: session.isAdmin,
        });
      } catch {
        // Silent fallback: existing session handling already covers invalid tokens elsewhere.
      }
    }

    void hydrateExistingSession();
    return () => {
      cancelled = true;
    };
  }, [authToken, walletAddress, setWalletSession]);

  useEffect(() => {
    if (!hasAuthenticatedSession || signer) {
      autoReconnectAttemptedRef.current = null;
      return;
    }

    if (autoReconnectAttemptedRef.current === walletAddress) {
      return;
    }

    let cancelled = false;
    autoReconnectAttemptedRef.current = walletAddress;

    async function attemptAutoReconnect() {
      const raw = window.localStorage.getItem('ccc-connection-info');
      if (!raw) {
        return;
      }

      let persisted: PersistedCccConnection | null = null;
      try {
        persisted = JSON.parse(raw) as PersistedCccConnection;
      } catch {
        return;
      }

      if (!persisted?.walletName || !persisted?.signerName) {
        return;
      }

      const findConnector = () =>
        document.querySelector('ccc-connector') as CccConnectorElement | null;

      let connector = findConnector();
      for (let attempt = 0; attempt < 10 && !cancelled; attempt += 1) {
        const wallets = connector?.signersControllerInner?.wallets;
        if (wallets && wallets.length > 0) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
        connector = findConnector();
      }

      if (cancelled || !connector?.signersControllerInner?.wallets?.length) {
        return;
      }

      const selectedWallet = connector.signersControllerInner.wallets.find(
        (item) => item.name === persisted.walletName,
      );
      const selectedSigner = selectedWallet?.signers.find(
        (item) => item.name === persisted.signerName,
      );

      if (!selectedWallet || !selectedSigner) {
        return;
      }

      try {
        await selectedSigner.signer.connect();

        if (cancelled || !(await selectedSigner.signer.isConnected())) {
          return;
        }

        connector.walletName = persisted.walletName;
        connector.signerName = persisted.signerName;
        await connector.refreshSigner?.();
        connector.requestUpdate?.();
      } catch {
        // Silent fallback: the UI will keep showing the reconnect hint.
      }
    }

    void attemptAutoReconnect();

    return () => {
      cancelled = true;
    };
  }, [hasAuthenticatedSession, signer, walletAddress]);

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

    async function hydrateConnectedAddress() {
      const currentSigner = activeSigner;
      if (!currentSigner) {
        return;
      }

      try {
        const address = await currentSigner.getRecommendedAddress();
        setConnectedAddress(address);
      } catch {
        // Ignore passive signer hydration errors.
      }
    }

    void hydrateConnectedAddress();
    void authenticateSigner(activeSigner);
  }, [
    authToken,
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
      setAuthStatus('error', formatAuthError(error));
    }
  }

  async function handleRetryAuthentication() {
    if (!signer) {
      return;
    }

    manualConnectRequestedRef.current = true;
    await authenticateSigner(signer, { force: true });
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

  const authHint = hasAuthenticatedSession
    ? hasLiveSigner
      ? walletSummary || 'Wallet connected and ready for agreement actions.'
      : 'You are still signed in, but your wallet needs to reconnect before you can approve payments or other onchain actions.'
    : hasLiveSigner
      ? authError
        ? authError
        : 'Approve the sign-in request in your wallet to continue.'
      : 'Connect a compatible wallet, then approve the sign-in request.';

  if (displayAddress) {
    if (compact) {
      return (
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${
            hasAuthenticatedSession
              ? 'border-agent-border bg-agent-card/80'
              : authStatus === 'error'
                ? 'border-red-400/40 bg-red-950/10'
                : 'border-amber-400/30 bg-amber-950/10'
          }`}>
            <span className={`h-2 w-2 rounded-full ${statusDotClass}`} />
            <span className="text-xs font-medium text-white">
              {displayAddress.slice(0, 6)}...{displayAddress.slice(-4)}
            </span>
            <span className="hidden text-[11px] text-gray-400 lg:inline">
              {connectionLabel}
            </span>
          </div>
          {needsAuthentication ? (
            <button
              onClick={handleRetryAuthentication}
              disabled={working || authStatus === 'authenticating'}
              className="ui-button-ghost rounded-full px-3 py-1.5 text-xs"
            >
              {authStatus === 'authenticating' ? 'Waiting...' : 'Sign In'}
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              disabled={working}
              className="ui-button-plain text-xs"
            >
              Disconnect
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-3">
        <div className={`flex min-w-0 flex-1 items-start gap-3 rounded-xl border px-3 py-2.5 sm:py-2 ${
          hasAuthenticatedSession
            ? 'border-agent-border bg-agent-card'
            : authStatus === 'error'
              ? 'border-red-400/40 bg-red-950/10'
              : 'border-amber-400/30 bg-amber-950/10'
        }`}>
          <div
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${statusDotClass}`}
          />
          <div className="flex min-w-0 flex-col">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {readinessPills.map((pill) => (
                <span
                  key={pill.label}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    pill.active
                      ? 'bg-emerald-500/15 text-emerald-200'
                      : 'bg-agent-bg/70 text-gray-500'
                  }`}
                >
                  {pill.label}
                </span>
              ))}
            </div>
            <span className="truncate text-xs font-mono text-gray-300">
              {displayAddress.slice(0, 12)}...{displayAddress.slice(-8)}
            </span>
            <span className={`mt-1 text-[10px] font-medium ${
              hasAuthenticatedSession ? 'text-gray-500' : 'text-gray-300'
            }`}>
              {connectionLabel}
            </span>
            <span className={`mt-1 text-[10px] ${
              hasAuthenticatedSession ? 'text-gray-500' : authStatus === 'error' ? 'text-red-200' : 'text-gray-400'
            }`}>
              {authHint}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {needsAuthentication ? (
            <button
              onClick={handleRetryAuthentication}
              disabled={working || authStatus === 'authenticating'}
              className="ui-button-ghost rounded-md px-3 py-1.5 text-xs"
            >
              {authStatus === 'authenticating' ? 'Waiting For Approval...' : authError ? 'Try Sign-In Again' : 'Approve Sign-In'}
            </button>
          ) : null}
          <button
            onClick={handleDisconnect}
            disabled={working}
            className="ui-button-plain self-start text-xs sm:self-auto"
          >
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <button
        onClick={handleConnect}
        disabled={working || authStatus === 'authenticating'}
        className="ui-button-primary-sm rounded-full px-4"
      >
        {working || authStatus === 'authenticating' ? 'Connecting...' : 'Connect Wallet'}
      </button>
    );
  }

  return (
    <div className="flex w-full flex-col items-start gap-1.5 sm:w-auto">
      <button
        onClick={handleConnect}
        disabled={working || authStatus === 'authenticating'}
        className="ui-button-primary-sm flex w-full sm:w-auto"
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
      <div className="flex flex-wrap gap-1.5 text-[10px] text-gray-500">
        <span className="ui-chip-muted px-2 py-0.5 normal-case tracking-normal">1. Connect wallet</span>
        <span className="ui-chip-muted px-2 py-0.5 normal-case tracking-normal">2. Approve sign-in</span>
        <span className="ui-chip-muted px-2 py-0.5 normal-case tracking-normal">3. Start using PactAgent</span>
      </div>
      <span className={`text-[11px] ${authError ? 'text-red-300' : 'text-gray-500'}`}>
        {authError || 'Connect your wallet, then approve the sign-in request to unlock agreements, invites, webhooks, and profile settings.'}
      </span>
    </div>
  );
}

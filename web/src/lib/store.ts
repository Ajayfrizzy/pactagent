import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  walletAddress: string | null;
  authToken: string | null;
  authExpiresAt: string | null;
  infrastructureApiKey: string | null;
  selectedInfrastructureAppId: string | null;
  isAdmin: boolean;
  hasHydrated: boolean;
  authStatus: 'idle' | 'authenticating' | 'authenticated' | 'error';
  authError: string | null;
  setWalletSession: (params: {
    walletAddress: string;
    authToken: string;
    authExpiresAt: string;
    isAdmin: boolean;
  }) => void;
  setAuthStatus: (status: AppState['authStatus'], error?: string | null) => void;
  clearWalletSession: () => void;
  setInfrastructureApiKey: (apiKey: string | null) => void;
  setSelectedInfrastructureAppId: (appId: string | null) => void;
  setHasHydrated: (hydrated: boolean) => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      walletAddress: null,
      authToken: null,
      authExpiresAt: null,
      infrastructureApiKey: null,
      selectedInfrastructureAppId: null,
      isAdmin: false,
      hasHydrated: false,
      authStatus: 'idle',
      authError: null,
      setWalletSession: ({ walletAddress, authToken, authExpiresAt, isAdmin }) => set({
        walletAddress,
        authToken,
        authExpiresAt,
        isAdmin,
        authStatus: 'authenticated',
        authError: null,
      }),
      setAuthStatus: (authStatus, authError = null) => set({ authStatus, authError }),
      setInfrastructureApiKey: (infrastructureApiKey) => set({ infrastructureApiKey }),
      setSelectedInfrastructureAppId: (selectedInfrastructureAppId) => set({ selectedInfrastructureAppId }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      clearWalletSession: () => set({
        walletAddress: null,
        authToken: null,
        authExpiresAt: null,
        infrastructureApiKey: null,
        selectedInfrastructureAppId: null,
        isAdmin: false,
        hasHydrated: true,
        authStatus: 'idle',
        authError: null,
      }),
    }),
    {
      name: 'pact-agent-session',
      partialize: (state) => ({
        walletAddress: state.walletAddress,
        authToken: state.authToken,
        authExpiresAt: state.authExpiresAt,
        infrastructureApiKey: state.infrastructureApiKey,
        selectedInfrastructureAppId: state.selectedInfrastructureAppId,
        isAdmin: state.isAdmin,
      }),
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    },
  ),
);

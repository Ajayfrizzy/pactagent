import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AgentLog {
  id: string;
  agreementId: string | null;
  level: string;
  eventType: string;
  message: string;
  metadataJson: string | null;
  createdAt: string;
}

interface AppState {
  walletAddress: string | null;
  authToken: string | null;
  authExpiresAt: string | null;
  authStatus: 'idle' | 'authenticating' | 'authenticated' | 'error';
  authError: string | null;
  setWalletSession: (params: {
    walletAddress: string;
    authToken: string;
    authExpiresAt: string;
  }) => void;
  setAuthStatus: (status: AppState['authStatus'], error?: string | null) => void;
  clearWalletSession: () => void;

  logs: AgentLog[];
  addLog: (log: AgentLog) => void;
  setLogs: (logs: AgentLog[]) => void;

  wsConnected: boolean;
  setWsConnected: (connected: boolean) => void;

  agreementUpdateCount: number;
  triggerAgreementUpdate: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      walletAddress: null,
      authToken: null,
      authExpiresAt: null,
      authStatus: 'idle',
      authError: null,
      setWalletSession: ({ walletAddress, authToken, authExpiresAt }) =>
        set({
          walletAddress,
          authToken,
          authExpiresAt,
          authStatus: 'authenticated',
          authError: null,
        }),
      setAuthStatus: (authStatus, authError = null) => set({ authStatus, authError }),
      clearWalletSession: () =>
        set({
          walletAddress: null,
          authToken: null,
          authExpiresAt: null,
          authStatus: 'idle',
          authError: null,
        }),

      logs: [],
      addLog: (log) =>
        set((state) => ({
          logs: [log, ...state.logs].slice(0, 200),
        })),
      setLogs: (logs) => set({ logs }),

      wsConnected: false,
      setWsConnected: (connected) => set({ wsConnected: connected }),

      agreementUpdateCount: 0,
      triggerAgreementUpdate: () =>
        set((state) => ({ agreementUpdateCount: state.agreementUpdateCount + 1 })),
    }),
    {
      name: 'pact-agent-session',
      partialize: (state) => ({
        walletAddress: state.walletAddress,
        authToken: state.authToken,
        authExpiresAt: state.authExpiresAt,
      }),
    }
  )
);

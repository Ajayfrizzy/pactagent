'use client';
import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/store';

/**
 * WebSocket hook for live Agent Log + Agreement updates.
 * Auto-reconnects on disconnect.
 */
export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const addLog = useStore((s) => s.addLog);
  const setWsConnected = useStore((s) => s.setWsConnected);
  const triggerAgreementUpdate = useStore((s) => s.triggerAgreementUpdate);

  useEffect(() => {
    const fallbackBase =
      process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/api\/?$/, '') || 'http://localhost:4000';
    const configuredWsUrl = process.env.NEXT_PUBLIC_WS_URL;

    function connect() {
      const wsUrl =
        configuredWsUrl ||
        `${fallbackBase.replace(/^http/, 'ws').replace(/^https/, 'wss')}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[WS] Connected');
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'LOG') {
            addLog(data.payload);
          } else if (data.type === 'AGREEMENT_UPDATE') {
            triggerAgreementUpdate();
          }
        } catch (err) {
          console.warn('[WS] Parse error:', err);
        }
      };

      ws.onclose = () => {
        console.log('[WS] Disconnected, reconnecting in 3s...');
        setWsConnected(false);
        setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, [addLog, setWsConnected, triggerAgreementUpdate]);
}

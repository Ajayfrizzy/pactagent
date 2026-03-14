import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

/**
 * WebSocket broadcast hub for live Agent Log + Agreement updates.
 * All connected frontend clients receive real-time events.
 */
let wss: WebSocketServer | null = null;

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    ws.send(JSON.stringify({ type: 'CONNECTED', payload: { message: 'PactAgent WS connected' } }));

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
    });
  });

  console.log('[WS] WebSocket server initialized on /ws');
}

/**
 * Broadcast an event to all connected clients.
 */
export function broadcast(event: { type: string; payload: unknown }): void {
  if (!wss) return;

  const data = JSON.stringify(event);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'http';
import { prisma } from './db';
import { normalizeWalletAddress, verifyAuthToken } from './services/authService';

type WsEvent =
  | { type: 'LOG'; payload: any }
  | { type: 'AGREEMENT_UPDATE'; payload: any };

type ClientContext = {
  mode: 'public' | 'participant';
  address: string | null;
};

let wss: WebSocketServer | null = null;
const clientContexts = new WeakMap<WebSocket, ClientContext>();

function getContextFromRequest(request: IncomingMessage): ClientContext {
  const requestUrl = new URL(request.url || '/ws', 'http://localhost');
  const token = requestUrl.searchParams.get('token');

  if (!token) {
    return {
      mode: 'public',
      address: null,
    };
  }

  try {
    const session = verifyAuthToken(token);
    return {
      mode: 'participant',
      address: session.address,
    };
  } catch {
    return {
      mode: 'public',
      address: null,
    };
  }
}

function getAgreementIdFromEvent(event: WsEvent) {
  if (event.type === 'LOG') {
    return event.payload?.agreementId || null;
  }

  if (event.type === 'AGREEMENT_UPDATE') {
    return event.payload?.id || null;
  }

  return null;
}

function isPublicLogEvent(event: WsEvent) {
  return (
    event.type === 'LOG' &&
    Boolean(event.payload?.agreementId) &&
    ['INFO', 'SUCCESS', 'WARN'].includes(event.payload?.level)
  );
}

function toPublicEvent(event: WsEvent): WsEvent {
  if (event.type !== 'LOG') {
    return event;
  }

  return {
    type: 'LOG',
    payload: {
      ...event.payload,
      metadataJson: null,
    },
  };
}

async function isAgreementVisibleToAddress(agreementId: string, address: string) {
  const normalizedAddress = normalizeWalletAddress(address);
  const agreement = await prisma.agreement.findFirst({
    where: {
      id: agreementId,
      OR: [
        { clientAddress: normalizedAddress },
        { workerAddress: normalizedAddress },
      ],
    },
    select: { id: true },
  });

  return Boolean(agreement);
}

function sendJson(ws: WebSocket, data: unknown) {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }

  ws.send(JSON.stringify(data));
}

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, request) => {
    const context = getContextFromRequest(request);
    clientContexts.set(ws, context);
    console.log(`[WS] Client connected (${context.mode}${context.address ? `:${context.address}` : ''})`);

    sendJson(ws, {
      type: 'CONNECTED',
      payload: {
        message: 'PactAgent WS connected',
        mode: context.mode,
      },
    });

    ws.on('close', () => {
      console.log('[WS] Client disconnected');
    });
  });

  console.log('[WS] WebSocket server initialized on /ws');
}

export function broadcast(event: WsEvent): void {
  if (!wss) return;

  const agreementId = getAgreementIdFromEvent(event);
  const visibilityCache = new Map<string, boolean>();

  void (async () => {
    for (const client of wss!.clients) {
      const context = clientContexts.get(client) || { mode: 'public', address: null };

      if (context.mode === 'public') {
        if (isPublicLogEvent(event)) {
          sendJson(client, toPublicEvent(event));
        }
        continue;
      }

      if (!context.address) {
        continue;
      }

      if (!agreementId) {
        continue;
      }

      let visible = visibilityCache.get(context.address);
      if (visible === undefined) {
        visible = await isAgreementVisibleToAddress(agreementId, context.address);
        visibilityCache.set(context.address, visible);
      }

      if (visible) {
        sendJson(client, event);
      }
    }
  })();
}

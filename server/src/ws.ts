import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'http';
import { prisma } from './db';
import { config } from './config';
import { normalizeWalletAddress, verifyAuthToken } from './services/authService';
import { log } from './common/observability/logger';

type WsEvent =
  | { type: 'LOG'; payload: any }
  | { type: 'AGREEMENT_UPDATE'; payload: any };

type ClientContext = {
  mode: 'public' | 'participant';
  address: string | null;
};

let wss: WebSocketServer | null = null;
const clientContexts = new WeakMap<WebSocket, ClientContext>();
const pendingContexts = new WeakMap<IncomingMessage, { context: ClientContext; ip: string }>();
const connectionsByIp = new Map<string, number>();
let heartbeatTimer: NodeJS.Timeout | null = null;

function getAuthToken(request: IncomingMessage) {
  const requestUrl = new URL(request.url || '/ws', 'http://localhost');
  if (requestUrl.searchParams.has('token')) {
    throw new Error('WebSocket credentials must not be sent in the URL.');
  }

  const protocols = String(request.headers['sec-websocket-protocol'] || '')
    .split(',')
    .map((protocol) => protocol.trim());
  return protocols.find((protocol) => protocol.startsWith('auth.'))?.slice(5) || null;
}

function getContextFromRequest(request: IncomingMessage): ClientContext {
  const token = getAuthToken(request);

  if (!token) {
    return {
      mode: 'public',
      address: null,
    };
  }

  const session = verifyAuthToken(token);
  return {
    mode: 'participant',
    address: session.address,
  };
}

function getClientIp(request: IncomingMessage) {
  const forwarded = String(request.headers['x-forwarded-for'] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (config.trustProxyHops > 0 && forwarded.length) {
    return forwarded[Math.max(0, forwarded.length - config.trustProxyHops)]!;
  }
  return request.socket.remoteAddress || 'unknown';
}

function isOriginAllowed(request: IncomingMessage) {
  const origin = request.headers.origin;
  if (!origin) return config.nodeEnv !== 'production';
  return config.corsOrigins.includes(origin);
}

function rejectUpgrade(request: IncomingMessage, status: number, message: string) {
  request.socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  request.socket.destroy();
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

  if (ws.bufferedAmount > config.wsMaxBufferedBytes) {
    ws.close(1013, 'Client is not consuming messages');
    return;
  }

  ws.send(JSON.stringify(data));
}

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.wsMaxPayloadBytes,
    handleProtocols: (protocols) => protocols.has('pactagent') ? 'pactagent' : false,
  });

  server.on('upgrade', (request, socket, head) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    if (path !== '/ws') {
      socket.destroy();
      return;
    }
    if (!isOriginAllowed(request)) {
      rejectUpgrade(request, 403, 'Forbidden');
      return;
    }

    const ip = getClientIp(request);
    if (wss!.clients.size >= config.wsMaxConnections || (connectionsByIp.get(ip) || 0) >= config.wsMaxConnectionsPerIp) {
      rejectUpgrade(request, 429, 'Too Many Requests');
      return;
    }

    try {
      pendingContexts.set(request, { context: getContextFromRequest(request), ip });
    } catch {
      rejectUpgrade(request, 401, 'Unauthorized');
      return;
    }

    wss!.handleUpgrade(request, socket, head, (ws) => wss!.emit('connection', ws, request));
  });

  wss.on('connection', (ws, request) => {
    const pending = pendingContexts.get(request);
    if (!pending) {
      ws.close(1008, 'Missing connection context');
      return;
    }
    pendingContexts.delete(request);
    const { context, ip } = pending;
    clientContexts.set(ws, context);
    connectionsByIp.set(ip, (connectionsByIp.get(ip) || 0) + 1);
    let isAlive = true;
    ws.on('pong', () => { isAlive = true; });
    log('info', 'websocket.connected', { mode: context.mode });

    sendJson(ws, {
      type: 'CONNECTED',
      payload: {
        message: 'PactAgent WS connected',
        mode: context.mode,
      },
    });

    ws.on('close', () => {
      const remaining = Math.max(0, (connectionsByIp.get(ip) || 1) - 1);
      if (remaining) connectionsByIp.set(ip, remaining);
      else connectionsByIp.delete(ip);
      log('info', 'websocket.disconnected', { mode: context.mode });
    });

    (ws as WebSocket & { checkAlive?: () => boolean }).checkAlive = () => {
      const alive = isAlive;
      isAlive = false;
      return alive;
    };
  });

  heartbeatTimer = setInterval(() => {
    for (const client of wss?.clients || []) {
      const tracked = client as WebSocket & { checkAlive?: () => boolean };
      if (tracked.checkAlive && !tracked.checkAlive()) client.terminate();
      else client.ping();
    }
  }, config.wsHeartbeatIntervalMs);
  heartbeatTimer.unref();
  log('info', 'websocket.initialized', { path: '/ws' });
}

export async function closeWebSocketServer() {
  const server = wss;
  if (!server) return;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  for (const client of server.clients) {
    client.close(1001, 'Server shutting down');
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  wss = null;
  connectionsByIp.clear();
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

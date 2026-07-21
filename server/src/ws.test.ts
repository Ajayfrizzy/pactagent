import assert from 'node:assert/strict';
import test from 'node:test';
import type { IncomingMessage } from 'http';
import { WebSocket } from 'ws';
import { config } from './config';
import {
  canAcceptWebSocketConnection, getAuthToken, heartbeatWebSocket, isOriginAllowed,
  isPublicLogEvent, sendJson, toPublicEvent, webSocketServerOptions,
} from './ws';

test('public WebSocket log events expose only the documented allowlist', () => {
  const event = toPublicEvent({
    type: 'LOG',
    payload: {
      id: 'log_1', agreementId: 'agreement_1', level: 'INFO', eventType: 'STATUS',
      message: 'Work updated', createdAt: '2026-07-20T00:00:00.000Z',
      metadataJson: '{"secret":"value"}', appId: 'app_private', clientAddress: 'ckt_private',
      internalNote: 'do not disclose',
    },
  });
  assert.deepEqual(Object.keys(event.payload).sort(), [
    'agreementId', 'createdAt', 'eventType', 'id', 'level', 'message',
  ]);
  assert.equal('metadataJson' in event.payload, false);
  assert.equal('appId' in event.payload, false);
});

test('WebSocket authentication accepts the subprotocol and rejects URL credentials', () => {
  const protocolRequest = {
    url: '/ws', headers: { 'sec-websocket-protocol': 'pactagent, auth.signed-token' },
  } as unknown as IncomingMessage;
  assert.equal(getAuthToken(protocolRequest), 'signed-token');
  assert.throws(() => getAuthToken({ url: '/ws?token=secret', headers: {} } as unknown as IncomingMessage), /must not be sent/);
});

test('WebSocket origin policy rejects unknown browser origins', () => {
  const allowed = config.corsOrigins[0];
  assert.equal(isOriginAllowed({ headers: { origin: allowed } } as unknown as IncomingMessage), true);
  assert.equal(isOriginAllowed({ headers: { origin: 'https://attacker.example' } } as unknown as IncomingMessage), false);
});

test('WebSocket backpressure closes clients that exceed the buffer bound', () => {
  let close: [number, string] | undefined;
  const socket = {
    readyState: WebSocket.OPEN,
    bufferedAmount: config.wsMaxBufferedBytes + 1,
    close(code: number, reason: string) { close = [code, reason]; },
    send() { assert.fail('message must not be sent to a backpressured client'); },
  } as unknown as WebSocket;
  sendJson(socket, { type: 'test' });
  assert.deepEqual(close, [1013, 'Client is not consuming messages']);
});

test('WebSocket server bounds payload and global/per-IP connections', () => {
  assert.equal(webSocketServerOptions().maxPayload, config.wsMaxPayloadBytes);
  assert.equal(canAcceptWebSocketConnection(0, 0), true);
  assert.equal(canAcceptWebSocketConnection(config.wsMaxConnections, 0), false);
  assert.equal(canAcceptWebSocketConnection(0, config.wsMaxConnectionsPerIp), false);
});

test('WebSocket heartbeat pings responsive clients and terminates stale clients', () => {
  let pinged = 0;
  let terminated = 0;
  const responsive = { checkAlive: () => true, ping: () => { pinged += 1; }, terminate: () => { terminated += 1; } } as unknown as WebSocket;
  const stale = { checkAlive: () => false, ping: () => { pinged += 1; }, terminate: () => { terminated += 1; } } as unknown as WebSocket;
  heartbeatWebSocket(responsive);
  heartbeatWebSocket(stale);
  assert.equal(pinged, 1);
  assert.equal(terminated, 1);
});

test('public WebSocket clients never receive agreement update objects or error logs', () => {
  assert.equal(isPublicLogEvent({ type: 'AGREEMENT_UPDATE', payload: { id: 'agreement_1' } }), false);
  assert.equal(isPublicLogEvent({ type: 'LOG', payload: { agreementId: 'agreement_1', level: 'ERROR' } }), false);
});

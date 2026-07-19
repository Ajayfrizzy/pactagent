import http from 'node:http';
import { config } from '../config';
import { prisma } from '../db';
import { isShuttingDown } from '../common/runtime/lifecycle';

function payload(status: string) {
  return JSON.stringify({
    status,
    version: config.buildVersion,
    commit: config.buildCommit,
    timestamp: new Date().toISOString(),
  });
}

export function createWorkerHealthServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') {
      res.statusCode = isShuttingDown() ? 503 : 200;
      res.end(payload(isShuttingDown() ? 'shutting_down' : 'ok'));
      return;
    }
    if (req.url === '/ready') {
      try {
        await prisma.$queryRaw`SELECT 1`;
        res.statusCode = isShuttingDown() ? 503 : 200;
        res.end(payload(isShuttingDown() ? 'not_ready' : 'ready'));
      } catch {
        res.statusCode = 503;
        res.end(payload('not_ready'));
      }
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ status: 'not_found' }));
  });
}

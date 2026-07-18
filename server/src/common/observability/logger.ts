import { redactSensitive } from '../security/redact';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  const entry = redactSensitive({
    timestamp: new Date().toISOString(),
    level,
    event,
    service: process.env.SERVICE_NAME || 'pactagent-server',
    environment: process.env.NODE_ENV || 'development',
    ...fields,
  });
  const line = JSON.stringify(entry);
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export function installConsoleBridge() {
  console.log = (...args: unknown[]) => log('info', 'console.log', { args });
  console.warn = (...args: unknown[]) => log('warn', 'console.warn', { args });
  console.error = (...args: unknown[]) => log('error', 'console.error', { args });
}

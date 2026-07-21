const SENSITIVE_KEY = /(authorization|cookie|token|secret|private.?key|password|signature|ciphertext|database.?url)/i;
const SENSITIVE_VALUE = /(Bearer\s+\S+|pa_(?:test|live)_\S+|whsec_\S+|sk-[A-Za-z0-9_-]{12,}|gh[oprsu]_[A-Za-z0-9_]{12,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|postgres(?:ql)?:\/\/[^\s]+)/gi;

export function redactSensitive(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    return value.replace(SENSITIVE_VALUE, '[REDACTED]');
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactSensitive(value.message),
      stack: redactSensitive(value.stack),
    };
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(item, seen),
  ]));
}

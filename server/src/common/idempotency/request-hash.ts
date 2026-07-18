import { createHash } from 'crypto';

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortObject(nestedValue)]),
    );
  }

  return value;
}

export function createRequestHash(params: {
  method: string;
  path: string;
  body: unknown;
}) {
  return createHash('sha256')
    .update(JSON.stringify({
      method: params.method.toUpperCase(),
      path: params.path,
      body: sortObject(params.body ?? {}),
    }))
    .digest('hex');
}

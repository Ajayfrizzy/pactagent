import test from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { AppError } from '../../common/errors/app-error';
import { requireInfrastructureAdmin } from './admin.auth';

function invokeGuard(req: Partial<Request>) {
  let nextCalled = false;
  requireInfrastructureAdmin(req as Request, {} as any, () => {
    nextCalled = true;
  });
  return nextCalled;
}

test('infrastructure admin guard rejects unauthenticated requests with standard app errors', () => {
  assert.throws(
    () => invokeGuard({}),
    (error) => error instanceof AppError
      && error.type === 'authentication_error'
      && error.statusCode === 401,
  );
});

test('infrastructure admin guard rejects non-admin wallet sessions', () => {
  assert.throws(
    () => invokeGuard({ auth: { address: 'ckt1nonadmin', isAdmin: false, issuedAt: 0, expiresAt: 0 } }),
    (error) => error instanceof AppError
      && error.type === 'permission_error'
      && error.code === 'admin_required',
  );
});

test('infrastructure admin guard allows admin wallet sessions', () => {
  assert.equal(
    invokeGuard({ auth: { address: 'ckt1admin', isAdmin: true, issuedAt: 0, expiresAt: 0 } }),
    true,
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { paginateAdminRows } from './admin.service';

test('admin pagination returns the next cursor when an extra row is fetched', () => {
  const result = paginateAdminRows(
    [
      { id: 'row_3', value: 3 },
      { id: 'row_2', value: 2 },
      { id: 'row_1', value: 1 },
    ],
    2,
    (row) => ({ id: row.id, value: row.value }),
  );

  assert.deepEqual(result.data, [
    { id: 'row_3', value: 3 },
    { id: 'row_2', value: 2 },
  ]);
  assert.deepEqual(result.pagination, {
    limit: 2,
    cursor: 'row_2',
  });
});

test('admin pagination returns null cursor when all rows fit', () => {
  const result = paginateAdminRows([{ id: 'row_1' }], 2, (row) => row);
  assert.deepEqual(result.pagination, {
    limit: 2,
    cursor: null,
  });
});

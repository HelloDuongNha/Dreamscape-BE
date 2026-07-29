import assert from 'node:assert/strict';
import test from 'node:test';
import { assertIsolatedTestDatabase } from '../support/testDatabase';

test('integration harness refuses non-test MongoDB databases before mutation', () => {
  assert.doesNotThrow(() =>
    assertIsolatedTestDatabase('mongodb://localhost:27017/dreamscape_test'),
  );
  assert.doesNotThrow(() =>
    assertIsolatedTestDatabase('mongodb://localhost:27017/dreamscape-test'),
  );
  assert.throws(
    () => assertIsolatedTestDatabase('mongodb://localhost:27017/dreamscape'),
    /dedicated MongoDB database/,
  );
  assert.throws(() => assertIsolatedTestDatabase('not-a-uri'), /dedicated MongoDB database/);
});

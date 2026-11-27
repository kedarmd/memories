import assert from 'node:assert/strict';
import test from 'node:test';
import { coreContractVersion, product } from '../src/index.ts';

test('scaffold exposes an agent-independent core marker', () => {
  assert.equal(product, 'Memories');
  assert.equal(coreContractVersion, 1);
});

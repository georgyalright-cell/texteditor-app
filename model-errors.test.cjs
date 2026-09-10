const test = require('node:test');
const assert = require('node:assert/strict');
const errors = require('./model-errors.js');
for (const [message, category] of [
  ['Failed to fetch https://example.test/Qwen-webgpu.wasm', 'network'],
  ['HTTP 404 https://example.test/webgpu.wasm', 'access'],
  ['WebGPU initialization timed out', 'timeout'],
  ['Cannot allocate buffer on GPUDevice', 'memory'],
  ['Unknown error https://example.test/adapter-webgpu.wasm', 'unknown'],
]) test(`resource names do not override the concrete cause: ${message}`, () => {
  assert.equal(errors.explain(message).category, category);
});
test('diagnostic preserves a bounded runtime error, not URL credentials or tokens', () => {
  const event = errors.event(Error('Failed to fetch https://user:pass@example.test/webgpu.wasm?token=secret#private Bearer verysecret'), {stage:'Загрузка'});
  assert.equal(event.diagnostic.category, 'network'); assert.equal(event.diagnostic.stage, 'Загрузка');
  assert.match(event.diagnostic.technical, /Failed to fetch https:\/\/example.test\/webgpu.wasm/);
  assert.doesNotMatch(event.diagnostic.technical, /user|pass|token|secret|private/);
  assert.ok(errors.event('x'.repeat(10000)).diagnostic.technical.length <= 1200);
});
test('unknown error redaction applies to every displayed field, not just technical details', () => {
  const raw='Unexpected condition https://user:pass@example.test/runtime?token=secret#private Bearer verysecret';
  const event=errors.event(Error(raw)); assert.equal(event.diagnostic.category,'unknown');
  assert.doesNotMatch(JSON.stringify(event),/user:|pass@|token=|secret|private/);
  assert.doesNotMatch(errors.explain(raw).message,/user:|pass@|token=|secret|private/);
});
for (const [message, category] of [['Failed to fetch', 'network'], ['HTTP 503', 'network'],
  ['HTTP 404 Not Found', 'access'], ['QuotaExceededError', 'storage'], ['out of memory', 'memory'],
  ['GPU device lost', 'gpu'], ['WebGPU недоступен', 'gpu'], ['timeout', 'timeout'], ['Unknown failure', 'unknown']]) {
  test(`actionable diagnostic: ${category}`, () => {
    const e = errors.explain(Error(message)); assert.equal(e.category, category); assert.ok(e.message.length > 60);
  });
}
test('network error is not asserted to be offline without browser evidence', () => {
  assert.match(errors.explain('Failed to fetch').message, /Возможны/);
  assert.equal(errors.explain('Failed to fetch', { offline: true }).category, 'offline');
});
test('transient failure retries exactly once and returns recovered result', async () => {
  let calls = 0, notices = 0;
  const result = await errors.retryOnce(async () => { if (++calls === 1) throw Error('Failed to fetch'); return 'ok'; },
    { offline: () => false, isCurrent: () => true, report: () => notices++ });
  assert.equal(result, 'ok'); assert.equal(calls, 2); assert.equal(notices, 1);
});
test('persistent failure, cancellation, offline and permanent errors cannot form a retry loop', async () => {
  for (const [message, online, current, expected] of [['Failed to fetch', true, true, 2],
    ['Failed to fetch', false, true, 1], ['Failed to fetch', true, false, 1], ['out of memory', true, true, 1]]) {
    let calls = 0;
    await assert.rejects(errors.retryOnce(async () => { calls++; throw Error(message); },
      { offline: () => !online, isCurrent: () => current, report() {} }));
    assert.equal(calls, expected);
  }
});

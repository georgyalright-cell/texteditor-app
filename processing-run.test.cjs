const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('./processing-run.js');

function fixture(overrides = {}) {
  const calls = [];
  const run = create({
    base: () => { calls.push('base'); return true; },
    supported: () => true,
    polish: async () => { calls.push('polish'); },
    cancel: () => calls.push('cancel'),
    notice: message => calls.push(message),
    busy: value => calls.push(value),
    ...overrides,
  });
  return { run, calls };
}

test('single start runs base then local editing and restores controls', async () => {
  const { run, calls } = fixture();
  assert.equal(await run.run(), true);
  assert.deepEqual(calls, [true, 'base', 'polish', false]);
  assert.equal(run.busy(), false);
});
test('without WebGPU retains basic result and explicitly explains fallback', async () => {
  const { run, calls } = fixture({ supported: () => false });
  await run.run();
  assert.equal(calls.includes('polish'), false);
  assert.match(calls[2], /WebGPU недоступен/);
  assert.equal(run.busy(), false);
});
test('failed or empty basic processing never edits an older result', async () => {
  const { run, calls } = fixture({ base: () => undefined });
  assert.equal(await run.run(), false);
  assert.deepEqual(calls, [true, false]);
});
test('concurrent starts are ignored and cancellation waits for cleanup', async () => {
  let finish;
  const { run, calls } = fixture({ polish: () => new Promise(resolve => { finish = resolve; }) });
  const pending = run.run();
  assert.equal(run.busy(), true);
  assert.equal(await run.run(), false);
  run.cancel();
  assert.equal(run.busy(), true);
  finish();
  assert.equal(await pending, false);
  assert.deepEqual(calls, [true, 'base', 'cancel', false]);
});
test('model exception retains text and permits another run', async () => {
  const { run, calls } = fixture({ polish: async () => { throw Error('GPU lost'); } });
  assert.equal(await run.run(), false);
  assert.match(calls[2], /Текущий текст сохранён.*GPU lost/);
  assert.equal(run.busy(), false);
  await run.run();
  assert.equal(calls.filter(v => v === 'base').length, 2);
});
test('cancelled/stale run cannot publish a later error over new content', async () => {
  let fail;
  const { run, calls } = fixture({ polish: () => new Promise((_, reject) => { fail = reject; }) });
  const pending = run.run();
  run.cancel(); fail(Error('late failure'));
  await pending;
  assert.deepEqual(calls, [true, 'base', 'cancel', false]);
});

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

test('default start runs all base processing without checking or loading models', async () => {
  const { run, calls } = fixture({ supported: () => { throw Error('must not inspect models'); } });
  assert.equal(await run.run(), true);
  assert.deepEqual(calls, [true, 'base', false]);
  assert.equal(run.busy(), false);
});
test('explicit model action edits the current result without repeating base processing', async () => {
  const { run, calls } = fixture();
  assert.equal(await run.run({ modelOnly: true }), true);
  assert.deepEqual(calls, [true, 'polish', false]);
  assert.equal(run.busy(), false);
});
test('without WebGPU retains basic result and explicitly explains fallback', async () => {
  const { run, calls } = fixture({ supported: () => false });
  await run.run({ modelOnly: true });
  assert.equal(calls.includes('polish'), false);
  assert.match(calls[1], /WebGPU недоступен/);
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
  const pending = run.run({ modelOnly: true });
  assert.equal(run.busy(), true);
  assert.equal(await run.run(), false);
  run.cancel();
  assert.equal(run.busy(), true);
  finish();
  assert.equal(await pending, false);
  assert.deepEqual(calls, [true, 'cancel', false]);
});
test('model exception retains text and permits another run', async () => {
  const { run, calls } = fixture({ polish: async () => { throw Error('GPU lost'); } });
  assert.equal(await run.run({ modelOnly: true }), false);
  assert.match(calls[1], /Текущий текст сохранён.*GPU lost/);
  assert.equal(run.busy(), false);
  await run.run();
  assert.equal(calls.filter(v => v === 'base').length, 1);
});
test('cancelled/stale run cannot publish a later error over new content', async () => {
  let fail;
  const { run, calls } = fixture({ polish: () => new Promise((_, reject) => { fail = reject; }) });
  const pending = run.run({ modelOnly: true });
  run.cancel(); fail(Error('late failure'));
  await pending;
  assert.deepEqual(calls, [true, 'cancel', false]);
});

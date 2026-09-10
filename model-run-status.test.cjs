const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('./model-run-status.js');
const errors = require('./model-errors.js');
test('original failure survives translated and generic messages; retry clears it', async () => {
  const f = fixture(); await f.status.track(async () => {
    f.status.progress(errors.event(Error('Failed to fetch https://example.test/webgpu.wasm'), {stage:'Подготовка генератора'}));
    f.status.progress({isError:true,message:'Текущая порция не завершена.'});
    return {completed:false};
  });
  assert.equal(f.state().diagnostic.category,'network');
  assert.match(f.state().diagnostic.technical,/Failed to fetch/);
  assert.equal(f.state().diagnostic.stage,'Подготовка генератора');
  assert.match(f.state().detail,/Проверьте сеть/);
  await f.status.track(async()=>({completed:true,modelUsed:true}));
  assert.equal(f.state().phase,'done'); assert.equal(f.state().diagnostic,null);
});
function fixture() {
  let state, time = 0, tick, stopped = 0;
  const status = create({ render: value => { state = value; }, now: () => time,
    every: cb => { tick = cb; return 1; }, stop: () => { stopped++; } });
  return { status, state: () => state, stopped: () => stopped, advance: ms => { time += ms; tick(); } };
}
test('download ready/100% never means paraphrasing completed; stalled progress is visible', async () => {
  const f = fixture(); let resolve;
  const task = f.status.track(() => new Promise(r => { resolve = r; }));
  f.status.progress({ progress: 100, message: 'Model ready', done: true });
  assert.equal(f.state().phase, 'running');
  f.advance(45000); assert.match(f.state().label, /Давно нет прогресса/);
  f.status.progress({ progress: 100, message: 'Model ready', done: true });
  assert.match(f.state().label, /Давно нет прогресса/);
  f.status.progress({ message: 'Generating sentence' }); assert.doesNotMatch(f.state().label, /Давно нет/);
  resolve({ completed: true, replaced: 1, modelUsed: true }); await task;
  assert.equal(f.state().phase, 'done'); assert.match(f.state().label, /✓/); assert.equal(f.stopped(), 1);
});
test('zero changes is an honest successful check, not a claim of rewriting', async () => {
  const f = fixture(); await f.status.track(async () => ({ completed: true, replaced: 0, modelUsed: true }));
  assert.equal(f.state().phase, 'done'); assert.match(f.state().detail, /замен не нашлось/);
});
test('no eligible text does not claim the model ran', async () => {
  const f = fixture(); await f.status.track(async () => ({ completed: true, modelUsed: false }));
  assert.equal(f.state().phase, 'unchanged'); assert.doesNotMatch(f.state().label, /✓/);
});
test('incomplete and fallback passes never get a green check', async () => {
  for (const result of [undefined, { completed: false }, { completed: true, limited: true, reason: 'Failed to fetch' }]) {
    const f = fixture(); await f.status.track(async () => result);
    assert.notEqual(f.state().phase, 'done'); assert.doesNotMatch(f.state().label, /✓/);
    assert.ok(f.state().detail.length > 30);
  }
});
test('concrete cause survives later generic batch errors', async () => {
  const f = fixture(); await f.status.track(async () => {
    f.status.progress({ isError: true, message: 'Failed to fetch' });
    f.status.progress({ isError: true, message: 'Текущая порция не завершена.' });
  });
  assert.match(f.state().detail, /файлы модели|файлов модели/);
  assert.match(f.state().detail, /Проверьте сеть/);
});
test('cancelled or timed-out work cannot overwrite the terminal status with late success', async () => {
  for (const reason of [undefined, 'timeout']) {
    const f = fixture(); let resolve;
    const task = f.status.track(() => new Promise(r => { resolve = r; }));
    f.status.cancel(reason); const phase = f.state().phase;
    resolve({ completed: true, replaced: 10 }); await task;
    f.status.progress({ progress: 100, message: 'Late ready' });
    assert.equal(f.state().phase, phase); assert.notEqual(phase, 'done');
  }
});
test('clearing or starting a new run rejects a stale completion', async () => {
  const f = fixture(); let resolve;
  const first = f.status.track(() => new Promise(r => { resolve = r; }));
  f.status.clear();
  await f.status.track(async () => ({ completed: true, limited: true, reason: 'GPU device lost' }));
  resolve({ completed: true }); await first;
  assert.equal(f.state().phase, 'partial'); assert.match(f.state().detail, /WebGPU/);
});
test('exception produces a concrete failure state and propagates to caller', async () => {
  const f = fixture();
  await assert.rejects(f.status.track(async () => { throw Error('out of memory'); }));
  assert.equal(f.state().phase, 'error'); assert.match(f.state().detail, /не хватило памяти/);
});

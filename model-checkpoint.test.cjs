const test = require('node:test');
const assert = require('node:assert/strict');
global.ReferenceGuard = require('./reference-guard.js');
global.AnchorGuard = require('./anchor-guard.js');
global.EditPasses = require('./edit-passes.js');
global.MaterialProcessing = require('./material-processing.js');
const checkpoint = require('./model-checkpoint.js');
const fresh = () => { delete require.cache[require.resolve('./automatic-revision.js')]; return require('./automatic-revision.js'); };

test('checkpoint rejects stale versions, changed output, invalid cursor and uncompleted edits', () => {
  const blocks = [{type:'paragraph', text:'The company reports growth [1-3].'}];
  const job = checkpoint.create(blocks);
  assert.ok(checkpoint.restore(job, blocks));
  assert.equal(checkpoint.restore({...job, version:0}, blocks), null);
  assert.equal(checkpoint.restore({...job, cursor:3}, blocks), null);
  assert.equal(checkpoint.restore(job, [{...blocks[0], text:'Different text.'}]), null);
  const detail = {start:0,end:blocks[0].text.length,before:blocks[0].text,after:'The company presents growth [1-3].'};
  const output = MaterialProcessing.apply(blocks, [detail]);
  assert.equal(checkpoint.restore({...job, details:[detail]}, output), null);
  assert.ok(checkpoint.restore({...job, cursor:1, details:[detail]}, output));
  assert.equal(checkpoint.restore({...job, cursor:1, details:[{...detail, after:detail.after.replace('1-3','2-4')}]}, output), null);
});

test('80/500 interrupted pass survives reload and completes only remaining 420 portions', async () => {
  let saved, calls = 0;
  global.MaterialDraft = {save: async value => {saved=structuredClone(value);}, load:async()=>structuredClone(saved)};
  const source = Array.from({length:5000}, (_,i)=>`The team reports result ${i}.`).join(' ');
  let current = source;
  global.PolishUI = {run:async o=>{
    if (++calls === 81) {o.collect({details:[],generatorWarnings:['Failed to fetch']}); return;}
    o.collect({details:[{start:0,end:o.text.length,before:o.text,after:o.text.replace('reports','presents')}],modelUsed:true});
  }};
  const options = () => ({text:current, language:'en',isCurrent:()=>true,report(){},apply:r=>{current=r.text;}});
  const first = await fresh().run(options());
  assert.equal(first.completed,false); assert.equal(saved.job.cursor,80);
  const resumed = fresh();
  assert.equal(await resumed.recover(),current); assert.equal(resumed.pending(current),true);
  calls=0;
  global.PolishUI.run = async o=>{calls++;o.collect({details:[],modelUsed:true});};
  const result = await resumed.run(options());
  assert.equal(result.completed,true); assert.equal(calls,420); assert.equal(saved.job.cursor,500);
  assert.equal(result.text,current); assert.equal(resumed.finished(current),true);
  await resumed.discard(); assert.equal(await fresh().recover(),null);
  delete global.MaterialDraft;
});

test('storage failure pauses before generation, and stale recovery cannot resurrect cleared work', async () => {
  let generated=false;
  global.MaterialDraft={save:async()=>{throw Error('quota');},load:async()=>null};
  global.PolishUI={run:async()=>{generated=true;}};
  const api=fresh();
  const result=await api.run({text:'A unique company reports stable growth.',isCurrent:()=>true,report(){},apply(){}});
  assert.equal(result.completed,false); assert.equal(generated,false); assert.match(result.reason,/не сохранил/);
  let resolve;
  global.MaterialDraft={load:()=>new Promise(r=>{resolve=r;}),save:async()=>{}};
  const pending=api.recover(); await api.discard();
  const base=[{type:'paragraph',text:'Saved text.'}];
  resolve({job:checkpoint.create(base),processed:base}); assert.equal(await pending,null);
  delete global.MaterialDraft;
});

test('batches include all sentences, up to ten and bounded by characters', () => {
  const text = Array.from({length:23},(_,i)=>`The company reports result ${i}.`).join(' ');
  const jobs=MaterialProcessing.jobs([{type:'paragraph',text}]).jobs;
  assert.deepEqual(jobs.map(j=>EditPasses.sentenceSpans(j.text,0).length),[10,10,3]);
  for(const j of jobs) assert.equal(text.slice(j.offset,j.offset+j.text.length),j.text);
  const long=Array.from({length:10},()=>`The company ${'carefully '.repeat(50)}reports results.`).join(' ');
  assert.ok(MaterialProcessing.jobs([{type:'paragraph',text:long}]).jobs.every(j=>j.text.length<=3500));
});

test('full coverage targets all ten eligible sentences instead of the preview share', async () => {
  const selector = require('./candidate-select.js');
  const text = Array.from({length:10},(_,i)=>`The company reviews supplier contracts in region ${i} to improve its purchasing process and reduce operational expenses.`).join(' ');
  let generated = 0;
  await selector.polishSentences(text, {language:'en',limit:10,fullCoverage:true,contextual:true,preferFresh:true,preview:true,
    generate:async()=>{generated++;return[];},score:async texts=>texts.map(()=>1)});
  assert.equal(generated,10);
});

test('stop during checkpoint transaction prevents subsequent generation and retains resume point', async () => {
  let release, saved, calls = 0;
  global.MaterialDraft = {save:value=>new Promise(r=>{ release=()=>{saved=structuredClone(value);r();}; }),load:async()=>saved};
  global.PolishUI = {run:async o=>{calls++;o.collect({details:[],modelUsed:true});}};
  const api = fresh();
  const task=api.run({text:'The company reviews supplier contracts to control operating costs.',isCurrent:()=>true,report(){},apply(){}});
  api.cancel(); release();
  assert.equal((await task).completed,false); assert.equal(calls,0); assert.equal(saved.job.cursor,0);
  assert.ok(await fresh().recover()); delete global.MaterialDraft;
});

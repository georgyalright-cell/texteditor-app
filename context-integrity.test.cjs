const test = require('node:test');
const assert = require('node:assert/strict');
global.ReferenceGuard = require('./reference-guard.js');
global.AnchorGuard = require('./anchor-guard.js');
global.EditPasses = require('./edit-passes.js');
const processing = require('./material-processing.js');
const automatic = require('./automatic-revision.js');
const before = 'Year-end reports guide the company in planning its budget.';
const after = 'The company uses year-end reports to plan its budget.';
function detail(source, before, after) {
  const start = source.indexOf(before);
  return {start, end:start+before.length, before, after};
}
test('video error reproduced: sentence passes locally but loses a contextual date in the document', () => {
  const source = `2024\n\n${before}`;
  assert.equal(AnchorGuard.compare(before,after).ok,true);
  assert.throws(()=>automatic.apply(source,[detail(source,before,after)]),/Замены отменены/);
  const selected = processing.accept([{type:'paragraph',text:source}],[],[detail(source,before,after)]);
  assert.equal(selected.rejected,1); assert.equal(selected.blocks[0].text,source);
  assert.equal(AnchorGuard.compare(source,selected.blocks[0].text).ok,true);
});
test('one context-rejected candidate cannot discard other safe edits or previous progress', () => {
  const other = 'The team reports stable growth [1-3].';
  const source=`The company reports progress.\n\n2024\n\n${before}\n\n${other}`;
  const previous=[detail(source,'The company reports progress.','The company presents progress.')];
  const next=processing.accept([{type:'paragraph',text:source}],previous,[detail(source,before,after),detail(source,other,'The team presents stable growth [1-3].')]);
  assert.equal(next.rejected,1); assert.equal(next.details.length,2);
  assert.match(next.blocks[0].text,/company presents progress/); assert.ok(next.blocks[0].text.includes(before));
  assert.match(next.blocks[0].text,/team presents stable growth \[1-3\]/);
  assert.equal(AnchorGuard.compare(source,next.blocks[0].text).ok,true);
});
test('changed citation, compensating number changes and overlap remain rejected', () => {
  const source='Sales reached 10 [1-3]. Costs reached 20.';
  const proposed=[detail(source,'Sales reached 10 [1-3].','Sales reached 20 [1-3].'),detail(source,'Costs reached 20.','Costs reached 10.'),detail(source,'Sales reached 10 [1-3].','Sales reached 10 [2-4].')];
  const result=processing.accept([{type:'paragraph',text:source}],[],proposed);
  assert.equal(result.rejected,3);assert.equal(result.blocks[0].text,source);
  const good=detail(source,'Costs reached 20.','Costs totalled 20.');
  assert.equal(processing.accept([{type:'paragraph',text:source}],[],[good,good]).details.length,1);
});
test('already invalid accepted state is not silently blessed', () => {
  const source=`2024\n\n${before}`;
  assert.throws(()=>processing.accept([{type:'paragraph',text:source}],[detail(source,before,after)],[]),/Сохранённые правки/);
});
test('legacy whole-document checkpoint with inconsistent contextual anchors is not resumed', () => {
  const checkpoint=require('./model-checkpoint.js');
  const base=[{type:'paragraph',text:'2024'},{type:'paragraph',text:before}];
  const job=checkpoint.create(base); job.cursor=job.jobs.length;
  job.details=[{start:6,end:6+before.length,before,after}];
  const processed=processing.apply(base,job.details);
  assert.equal(checkpoint.restore(job,processed),null);
  assert.equal(processed[1].text,after); // persisted document is not mutated/deleted
});
test('automatic long pass continues beyond rejected replacement instead of throwing video error', async () => {
  const prefix=Array.from({length:9},()=> 'The firm reports stable operating results.').join(' ');
  const other='The team reports steady progress [1-3].';
  const source=`${prefix}\n\n2024\n\n${before}\n\n${other}`;
  let calls=0;
  global.PolishUI={run:async o=>{
    calls++;
    const details=[];
    if(o.text.includes(before)) details.push(detail(o.text,before,after));
    if(o.text.includes(other)) details.push(detail(o.text,other,'The team presents steady progress [1-3].'));
    o.collect({details,modelUsed:true});
  }};
  const result=await automatic.run({text:source,isCurrent:()=>true,report(){},apply(){}});
  assert.equal(result.completed,true);assert.equal(result.limited,false);assert.ok(calls>=2);
  assert.ok(result.text.includes(before));assert.match(result.text,/presents steady progress/);
  assert.equal(AnchorGuard.compare(source,result.text).ok,true);assert.ok(result.warnings.includes(processing.INTEGRITY_NOTE));
});
test('integrity error is explained as data protection, not unknown or network failure',()=>{
  const e=require('./model-errors.js').explain('Замены отменены: изменились ссылки или числовые данные.');
  assert.equal(e.category,'integrity');assert.equal(e.retryable,false);assert.match(e.message,/не ошибка интернета/);
});

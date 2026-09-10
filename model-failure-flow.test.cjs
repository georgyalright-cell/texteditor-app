const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const errors = require('./model-errors.js');
const source = name => fs.readFileSync(require.resolve(name), 'utf8');

function polishFixture({ warning = '', rankingFailed = false, throwError = false, collectError = false } = {}) {
  const progress = [], calls = [], reports = [];
  const root = {
    navigator:{onLine:true}, ModelErrors:errors,
    NeuralScorerUI:{lockForPolish:()=>true,unlockAfterPolish:()=>calls.push('unlock'),
      cancelPolishScoring:()=>calls.push('reset-scorer'),reportProgress:e=>progress.push(e)},
    NeuralRanking:{create:()=>({score(){},summary:()=>rankingFailed?'GPUDevice lost':'Оценка завершена',
      limited:()=>rankingFailed,failed:()=>rankingFailed,pair:()=>null})},
    Generator:{paraphrase:async()=>['Revised.'],cancel:()=>calls.push('reset-generator'),release:()=>calls.push('release')},
    SemanticScorer:{cancel:()=>calls.push('reset-semantic')},
    CandidateSelect:{deterministicScorer(){},polishSentences:async(text,o)=>{
      if(throwError) throw Error('Runtime failed');
      if(!warning) await o.generate(text,{});
      return {ok:true,details:[],generatorWarnings:warning?[warning]:[],warnings:[],replaced:0};
    }}, RevisionPreview:{clear(){}},
  };
  vm.runInNewContext(source('./polish-ui.js'),{window:root,setTimeout,clearTimeout});
  return {root,progress,calls,reports, run:()=>root.PolishUI.run({text:'Source.',language:'en',isCurrent:()=>true,
    collect:r=>{if(collectError)throw Error('Collection failed');calls.push(r);},report:(...a)=>reports.push(a)})};
}
for(const config of [{warning:'Failed to fetch https://example.test/webgpu.wasm'},{rankingFailed:true},{throwError:true},{collectError:true}]) {
  test(`failed model stage never marks batch successful: ${JSON.stringify(config)}`,async()=>{
    const f=polishFixture(config); await f.run();
    assert.equal(f.progress.at(-1).isError,true);
    assert.match(f.progress.at(-1).message,/не завершена/);
    for(const step of ['reset-generator','reset-semantic','reset-scorer','unlock']) assert.ok(f.calls.includes(step));
    assert.equal(f.root.PolishUI.busy(),false);
    assert.ok(f.progress.some(e=>e.diagnostic));
  });
}
test('successful batch awaits document commit rather than claiming whole-pass completion',async()=>{
  const f=polishFixture(); await f.run();
  assert.match(f.progress.at(-1).message,/проверку и сохранение/);
  assert.equal(f.progress.at(-1).isError,false); assert.ok(f.calls.includes('release'));
  assert.equal(f.root.PolishUI.busy(),false);
});

test('generator worker reports actual load vs inference stage and can run again',async()=>{
  const messages=[], listeners={}; let failLoad=true, failInference=false;
  const context={URL,Date,Uint32Array,Error,CreateMLCEngine:async()=>{
    if(failLoad) throw Error('Failed to fetch webgpu.wasm');
    return {chat:{completions:{create:async()=>{if(failInference)throw Error('GPUDevice lost'); return {};}}}};
  },self:{location:{href:'https://example.test/generator-worker.js'},postMessage:m=>messages.push(m),
    addEventListener:(k,f)=>listeners[k]=f,ModelProgress:{generator:r=>r},
    GeneratorCore:{variantCount:()=>1,generationPlan:()=>[{}],buildMessages:()=>[],outputBudget:()=>160,
      completedChoices:()=>['Revised.'],parseVariants:r=>r}}};
  vm.createContext(context);
  vm.runInContext(source('./generator-worker.js').replace(/^import .*;\n/gm,''),context);
  const run=async id=>{listeners.message({data:{type:'paraphrase',id,sentence:'Source.'}});await vm.runInContext('queue',context);return messages.at(-1);};
  assert.match((await run(1)).stage,/Подготовка/);
  failLoad=false; assert.equal((await run(2)).type,'variants');
  failInference=true; const failed=await run(3);
  assert.match(failed.stage,/перефразирование/); assert.match(failed.message,/GPUDevice lost/);
});

test('semantic runtime error and timeout are not reported as user cancellation; resume uses fresh worker',async()=>{
  const workers=[],timers=[];
  class Worker {constructor(){workers.push(this);}postMessage(){}terminate(){this.terminated=true;}}
  const root={Worker};
  vm.runInNewContext(source('./semantic-scorer.js'),{window:root,globalThis:root,Error,
    setTimeout:f=>{timers.push(f);return timers.length;},clearTimeout(){}});
  const first=root.SemanticScorer.score([['a','b']]); workers[0].onerror({message:'GPUDevice lost'});
  await assert.rejects(first,/GPUDevice lost/); assert.equal(workers[0].terminated,true);
  const second=root.SemanticScorer.score([['a','b']]); workers[0].onerror({message:'Late error'});
  workers[1].onmessage({data:{type:'scores',id:2,scores:[1]}}); assert.deepEqual(await second,[1]);
  const third=root.SemanticScorer.score([['a','b']]); timers.at(-1)(); await assert.rejects(third,/timeout/);
});

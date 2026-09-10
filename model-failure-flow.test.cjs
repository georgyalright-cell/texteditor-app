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
  },self:{navigator:{gpu:{requestAdapter:async()=>({features:new Set(['shader-f16']),limits:{maxBufferSize:268435456,maxStorageBufferBindingSize:134217728,maxComputeWorkgroupStorageSize:32768,maxStorageBuffersPerShaderStage:10}})}},location:{href:'https://example.test/generator-worker.js'},postMessage:m=>messages.push(m),
    addEventListener:(k,f)=>listeners[k]=f,ModelProgress:{generator:r=>r},
    GeneratorCore:{variantCount:()=>1,generationPlan:()=>[{}],buildMessages:()=>[],outputBudget:()=>160,
      completedChoices:()=>['Revised.'],parseVariants:r=>r}}};
  context.self.GpuSupport=require('./gpu-support.js').create(context.self);
  vm.createContext(context);
  vm.runInContext(source('./generator-worker.js').replace(/^import .*;\n/gm,''),context);
  const run=async id=>{listeners.message({data:{type:'paraphrase',id,sentence:'Source.'}});await vm.runInContext('queue',context);return messages.at(-1);};
  assert.match((await run(1)).stage,/Подготовка/);
  failLoad=false; assert.equal((await run(2)).type,'variants');
  failInference=true; const failed=await run(3);
  assert.match(failed.stage,/перефразирование/); assert.match(failed.message,/GPUDevice lost/);
});

test('semantic phase releases generator first and embeddings before ranking',async()=>{
  const f=polishFixture();
  f.root.SemanticScorer.score=async()=>{f.calls.push('embed');return[0.98];};
  f.root.CandidateSelect.polishSentences=async(text,o)=>{
    await o.generate(text,{});await o.semanticScore([{source:text,candidate:'Revised.'}]);
    f.calls.push('rank');return {ok:true,details:[],generatorWarnings:[],warnings:[]};
  };
  await f.run();
  assert.ok(f.calls.indexOf('reset-generator')<f.calls.indexOf('embed'));
  assert.ok(f.calls.indexOf('reset-semantic')<f.calls.indexOf('rank'));
});

test('failed generation never starts downstream models for an uncommittable batch',async()=>{
  const f=polishFixture();let embeddings=0,scoring=0;
  f.root.Generator.paraphrase=async()=>{throw Error('WebGPU: shader-f16 required');};
  f.root.SemanticScorer.score=async()=>{embeddings++;};
  f.root.NeuralRanking.create=()=>({score:()=>{scoring++;}});
  f.root.CandidateSelect.polishSentences=async(text,o)=>{
    await assert.rejects(o.generate(text,{}),/shader-f16/);
    await assert.rejects(o.semanticScore([['source','variant']]),/shader-f16/);
    assert.throws(()=>o.score(['source','variant']),/shader-f16/);
    throw Error('WebGPU: shader-f16 required');
  };
  await f.run();assert.equal(embeddings,0);assert.equal(scoring,0);
  assert.equal(f.progress.at(-1).isError,true);assert.equal(f.root.PolishUI.busy(),false);
});

for (const unsupported of ['adapter','shader-f16','maxBufferSize','maxStorageBufferBindingSize','maxComputeWorkgroupStorageSize','maxStorageBuffersPerShaderStage']) {
  test(`generator rejects unsupported ${unsupported} before model download`,async()=>{
    const messages=[],listeners={};let loads=0;
    const adapter={features:new Set(['shader-f16']),limits:{maxBufferSize:268435456,
      maxStorageBufferBindingSize:134217728,maxComputeWorkgroupStorageSize:32768,maxStorageBuffersPerShaderStage:10}};
    if(unsupported==='shader-f16')adapter.features.clear();else adapter.limits[unsupported]=0;
    const context={URL,Date,Error,CreateMLCEngine:async()=>{loads++;},self:{
      navigator:{gpu:{requestAdapter:async()=>unsupported==='adapter'?null:adapter}},
      location:{href:'https://example.test/generator-worker.js'},postMessage:m=>messages.push(m),
      addEventListener:(type,fn)=>listeners[type]=fn,GeneratorCore:{variantCount:()=>1}}};
    context.self.GpuSupport=require('./gpu-support.js').create(context.self);
    vm.createContext(context);vm.runInContext(source('./generator-worker.js').replace(/^import .*;\n/gm,''),context);
    listeners.message({data:{type:'paraphrase',id:1,sentence:'Source.'}});await vm.runInContext('queue',context);
    assert.equal(loads,0);assert.equal(messages.at(-1).type,'error');
    assert.match(messages.at(-1).message,/Файлы модели не загружались/);
  });
}

test('semantic timeout follows real progress and all timers clear on completion',async()=>{
  const workers=[],timers=new Map();let serial=0;
  class Worker{constructor(){workers.push(this);}postMessage(m){this.last=m;}terminate(){}}
  const root={Worker};
  vm.runInNewContext(source('./semantic-scorer.js'),{globalThis:root,Error,
    setTimeout:f=>{timers.set(++serial,f);return serial;},clearTimeout:id=>timers.delete(id)});
  const task=root.SemanticScorer.score([['a','b']]);const initial=serial;
  const progress={type:'progress',message:'Loading',progress:1};workers[0].onmessage({data:progress});
  assert.ok(serial>initial);const renewed=serial;assert.equal(timers.size,1);
  workers[0].onmessage({data:progress});assert.equal(serial,renewed);
  workers[0].onmessage({data:{...progress,progress:2}});assert.ok(serial>renewed);
  workers[0].onmessage({data:{type:'scores',id:workers[0].last.id,scores:[1]}});
  await task;assert.equal(timers.size,0);
});

test('active work may exceed 15 minutes; only inactivity triggers the watchdog',async()=>{
  let time=0,activity=0,watch,resolve,cancelled=0;
  const root={ModelRunStatus:{lastActivity:()=>activity,cancel:()=>cancelled++},
    NeuralScorerUI:{lockForPolish:()=>true,reportProgress(){},unlockAfterPolish(){},cancelPolishScoring(){}},
    NeuralRanking:{create:()=>({})},Generator:{cancel(){},release(){}},SemanticScorer:{cancel(){}},
    CandidateSelect:{deterministicScorer(){},polishSentences:()=>new Promise(r=>resolve=r)},RevisionPreview:{clear(){}}};
  vm.runInNewContext(source('./polish-ui.js'),{window:root,Date:{now:()=>time},setTimeout:f=>{watch=f;return 1;},clearTimeout(){}});
  const task=root.PolishUI.run({text:'Source.',isCurrent:()=>true,collect(){},report(){}});
  time=20*60*1000;activity=time-1000;watch();assert.equal(cancelled,0);
  time+=15*60*1000;watch();assert.equal(cancelled,1);
  resolve({ok:true,details:[]});await task;assert.equal(root.PolishUI.busy(),false);
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

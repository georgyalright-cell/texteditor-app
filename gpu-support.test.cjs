const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('./gpu-support.js');
const adapter=()=>({features:new Set(['shader-f16']),limits:{maxBufferSize:268435456,
  maxStorageBufferBindingSize:134217728,maxComputeWorkgroupStorageSize:32768,maxStorageBuffersPerShaderStage:10}});
test('API presence alone never enables model use; adapter must be available',async()=>{
  const gpu=create({navigator:{gpu:{requestAdapter:async()=>null}}});
  assert.equal(gpu.ready(),false);await gpu.refresh();assert.equal(gpu.ready(),false);
  assert.equal(gpu.snapshot().code,'adapter');assert.match(gpu.snapshot().message,/аппаратное ускорение/);
});
test('compatible adapter enables models, without creating a device or loading files',async()=>{
  const gpu=create({navigator:{gpu:{requestAdapter:async o=>{assert.equal(o.powerPreference,'high-performance');return adapter();}}}});
  await gpu.refresh();assert.equal(gpu.ready(),true);
});
test('insecure context, missing API, missing f16, low limits and rejected requests are blocked',async()=>{
  for(const [root,code]of [
    [{isSecureContext:false},'context'],[{},'api'],
    [{navigator:{gpu:{requestAdapter:async()=>({...adapter(),features:new Set()})}}},'feature'],
    [{navigator:{gpu:{requestAdapter:async()=>({...adapter(),limits:{}})}}},'limits'],
    [{navigator:{gpu:{requestAdapter:async()=>{throw Error('unavailable')}}}},'probe'],
  ]){const gpu=create(root);await gpu.refresh();assert.equal(gpu.ready(),false);assert.equal(gpu.snapshot().code,code);}
});
test('concurrent refreshes share a probe; later refresh can recover blocked access',async()=>{
  let resolve,calls=0;const events=[];
  const gpu=create({navigator:{gpu:{requestAdapter:()=>{calls++;return new Promise(r=>resolve=r);}}}});
  gpu.subscribe(s=>events.push(s.status));const a=gpu.refresh(),b=gpu.refresh();assert.equal(a,b);assert.equal(calls,1);
  resolve(null);await a;assert.equal(gpu.ready(),false);
  const next=gpu.refresh();resolve(adapter());await next;assert.equal(gpu.ready(),true);
  assert.deepEqual(events,['checking','blocked','checking','ready']);
});
test('generator API cannot create a worker while GPU support is blocked',async()=>{
  let workers=0;const root={navigator:{gpu:{}},GpuSupport:{ready:()=>false},Worker:class{constructor(){workers++;}}};
  const generator=require('./generator.js').create(root);
  assert.equal(generator.supported(),false);await assert.rejects(generator.paraphrase('Source.'),/WebGPU/);assert.equal(workers,0);
});
test('adapter failure has a concrete hardware-acceleration explanation',()=>{
  const result=require('./model-errors.js').explain(Error('WebGPU: браузер не предоставил совместимый видеоускоритель. Файлы модели не загружались.'));
  assert.equal(result.category,'gpu');assert.equal(result.retryable,false);assert.match(result.message,/аппаратное ускорение/);
});
test('probe timeout is bounded and a late adapter cannot overwrite a fresh result',async()=>{
  const vm=require('node:vm'),fs=require('node:fs');let timeout,late,cleared=0;
  const root={navigator:{gpu:{requestAdapter:()=>new Promise(r=>late=r)}}};
  const ctx={...root,setTimeout:fn=>{timeout=fn;return 1;},clearTimeout:()=>cleared++};
  vm.runInNewContext(fs.readFileSync(require.resolve('./gpu-support.js'),'utf8'),ctx);
  const task=ctx.GpuSupport.refresh();timeout();await task;assert.equal(ctx.GpuSupport.snapshot().code,'probe');assert.ok(cleared>0);
  root.navigator.gpu.requestAdapter=async()=>null;await ctx.GpuSupport.refresh();
  late(adapter());await Promise.resolve();assert.equal(ctx.GpuSupport.snapshot().code,'adapter');
});

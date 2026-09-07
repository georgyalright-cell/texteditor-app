"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
function worker() {
  const messages=[];
  const ctx=vm.createContext({self:{postMessage:m=>messages.push(m),addEventListener:()=>{},NeuralScorerCore:require("./neural-scorer-core.js")},importScripts:()=>{},URL,Float32Array,BigInt64Array});
  vm.runInContext(fs.readFileSync(require.resolve("./neural-worker.js"),"utf8"),ctx);
  vm.runInContext(`
    var calls=0,disposed=0,lastTruncation;
    tokenizer=async(text,options)=>{lastTruncation=options.truncation;return {input_ids:{data:new BigInt64Array(text==='long'?129:text==='short'?3:8),dispose(){disposed++}}}};
    observer=performer=async(inputs)=>{calls++;return {logits:{data:new Float32Array(inputs.input_ids.data.length*2),dims:[1,inputs.input_ids.data.length,2],dispose(){disposed++}}}};
  `,ctx);
  return {ctx,messages};
}
test("strict scoring rejects whole sentences over 128 tokens without running inference",async()=>{
  const {ctx}=worker();assert.equal(await vm.runInContext('scoreText("long","test",true)',ctx),null);
  assert.equal(ctx.calls,0);assert.equal(ctx.lastTruncation,false);assert.equal(ctx.disposed,1);
});
test("strict scoring rejects too-short inputs and marks complete finite scores",async()=>{
  const {ctx}=worker();assert.equal(await vm.runInContext('scoreText("short","test",true)',ctx),null);
  const value=await vm.runInContext('scoreText("valid","test",true)',ctx);
  assert.equal(value.complete,true);assert.equal(value.tokenCount,8);assert.ok(Number.isFinite(value.logPerplexity));
});
test("a batch caches duplicate inputs and preserves null rather than inventing a score",async()=>{
  const {ctx}=worker();const values=await vm.runInContext('scoreBatch(["valid","valid","long"],true)',ctx);
  assert.equal(ctx.calls,2);assert.equal(values[0].perplexity,values[1].perplexity);assert.equal(values[2],null);
});
test("oversized batches fail before invoking models",async()=>{
  const {ctx,messages}=worker();await vm.runInContext('handle({type:"scoreMany",id:7,fullText:true,texts:Array(33).fill("valid")})',ctx);
  assert.equal(ctx.calls,0);assert.equal(messages.at(-1).type,"error");assert.equal(messages.at(-1).id,7);
});
test("unavailable GPU fails before downloading a runtime or model",async()=>{
  const {ctx}=worker();
  vm.runInContext('tokenizer=observer=performer=null',ctx);
  await assert.rejects(vm.runInContext('loadModels()',ctx),/WebGPU/);
  assert.equal(ctx.calls,0);
});
test("PPL-only batch needs one forward pass and no performer",async()=>{
  const {ctx}=worker();vm.runInContext('performer=null',ctx);
  const result=await vm.runInContext('scoreBatch(["valid","valid"],true,true)',ctx);
  assert.equal(ctx.calls,1);assert.equal(result[0].complete,true);
  assert.equal(result[0].binoculars,undefined);assert.equal(result[0].perplexity,2);
});

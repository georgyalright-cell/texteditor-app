"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const progress=require("./model-progress.js");
test("file progress reports actual bytes, model and file without claiming a full download",()=>{
  const value=progress.transformers("MiniLM",{status:"progress",file:"onnx/model.onnx",loaded:50000000,total:100000000,progress:50});
  assert.equal(value.progress,50);assert.match(value.message,/MiniLM.*model.onnx.*50.0 МБ из 100.0 МБ.*50% файла/);
  assert.match(value.message,/сеть или кэш/);
});
test("unknown totals and invalid progress never invent a percentage or denominator",()=>{
  const value=progress.transformers("Qwen",{status:"progress",loaded:1234,progress:NaN});
  assert.equal(value.progress,null);assert.doesNotMatch(value.message,/%|из|NaN/);
  assert.equal(progress.generator({progress:null}).progress,null);
  assert.equal(progress.percent(Infinity),null);assert.equal(progress.percent(500),100);
});
test("a completed file does not declare model readiness or show a stuck full bar",()=>{
  const value=progress.transformers("Qwen",{status:"done",file:"model.onnx",progress:100});
  assert.equal(value.progress,null);assert.match(value.message,/подготовка модели/);
});
test("WebLLM cache and GPU compilation are distinct from obtaining weights",()=>{
  const cache=progress.generator({progress:.5,text:"Loading model from cache[16/32]: 400MB loaded."});
  assert.match(cache.message,/Из кэша → в память.*16 из 32.*419.4 МБ.*50% этапа/);
  const shader=progress.generator({progress:.2,text:"Loading GPU shader modules[2/10]: 20% completed"});
  assert.match(shader.message,/не скачивание/);assert.equal(shader.progress,20);
  assert.match(progress.generator({progress:.1,text:"Fetching param cache[1/32]: 80MB fetched."}).message,/Получение файлов/);
});

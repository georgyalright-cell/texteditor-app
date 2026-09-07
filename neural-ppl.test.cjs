"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {scorePerplexity,scoreLogits}=require("./neural-scorer-core.js");
test("single-model PPL matches teacher-forced likelihood in the pair calculation",()=>{
  const logits=new Float32Array([1,2,3,4,5,6,7,8,9]),ids=[0,1,2],dims=[1,3,3];
  const single=scorePerplexity(logits,ids,dims),pair=scoreLogits(logits,logits,ids,dims,dims);
  assert.equal(single.logPerplexity,pair.logPerplexity);assert.equal(single.perplexity,pair.perplexity);
  assert.equal(single.tokenCount,3);
});
test("single-model PPL is stable for large logits and rejects incomplete/nonfinite input",()=>{
  assert.equal(scorePerplexity([10000,10000,10000,10000],[0,1],[1,2,2]).perplexity>1.999,true);
  assert.throws(()=>scorePerplexity([0,0],[0,1],[1,2,2]),/Неполные/);
  assert.throws(()=>scorePerplexity([0,0,0,0],[0,1,1],[1,2,2]),/Неполные/);
  assert.throws(()=>scorePerplexity([NaN,0,0,0],[0,1],[1,2,2]),/Неконечные/);
  assert.throws(()=>scorePerplexity([0,0,0,0],[0,3],[1,2,2]),/токен/);
});

"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("./neural-ranking.js");
const selector = require("./candidate-select.js");
const item = (nll, complete=true) => ({ logPerplexity:nll, perplexity:Math.exp(nll),tokenCount:20,complete });
const context = {groups:[{offset:0,count:3}]};
function setup(details, extra={}) {
  const order=[];
  const ranker=api.create({baseline:async texts=>texts.map(()=>10),isCancelled:()=>false,
    releaseGenerator:()=>order.push("release"), engine:{scoreDetails:async (_texts,options)=>{order.push("score");assert.equal(options.fullText,true);assert.equal(options.perplexityOnly,true);return details}},...extra});
  return {ranker,order};
}
test("PPL scoring starts after generator release and never rewards unpredictability", async()=>{
  const {ranker,order}=setup([item(3),item(4),item(2)]);
  assert.deepEqual(await ranker.score(["original","higher","lower"],context),[10,14,10]);
  assert.deepEqual(order,["release","score"]);
  assert.equal(ranker.pair("original","higher").after.perplexity,Math.exp(4));
});
test("incomplete or nonfinite metrics fall back for the entire comparison group",async()=>{
  for(const invalid of [null,item(3,false),item(NaN),{...item(3),perplexity:0}]) {
    const {ranker}=setup([item(3),item(4),invalid]);
    assert.deepEqual(await ranker.score(["a","b","c"],context),[10,10,10]);
    assert.equal(ranker.pair("a","b"),null);assert.match(ranker.summary(),/пропущено 3/);
  }
});
test("neural failure cannot erase deterministic results; partial replies are reported",async()=>{
  for(const scoreDetails of [async()=>{throw Error("offline")},async()=>[]]) {
    const {ranker}=setup([],{engine:{scoreDetails}});
    assert.deepEqual(await ranker.score(["a","b","c"],context),[10,10,10]);
    assert.match(ranker.summary(),/недоступна/);
  }
});
test("cancelled work cannot start or finish neural ranking",async()=>{
  let cancelled=true,calls=0;
  const {ranker}=setup([],{isCancelled:()=>cancelled,engine:{scoreDetails:async()=>{calls++;cancelled=true;return [item(3),item(3),item(3)]}}});
  await assert.rejects(ranker.score(["a","b","c"],context),/остановлена/);assert.equal(calls,0);
  cancelled=false;await assert.rejects(ranker.score(["a","b","c"],context),/остановлена/);assert.equal(calls,1);
});
test("each sentence is compared against its own original, not the document average",async()=>{
  const {ranker}=setup([item(3),item(4),item(8),item(7)]);
  assert.deepEqual(await ranker.score(["a","b","c","d"],{groups:[{offset:0,count:2},{offset:2,count:2}]}),[10,14,10,10]);
});
test("no candidates means no extra model download",async()=>{
  const {ranker,order}=setup([]);
  assert.deepEqual(await ranker.score(["a"],{groups:[{offset:0,count:1}]}),[10]);assert.deepEqual(order,[]);
});
test("shortlist supplies original and at most two eligible variants per sentence",async()=>{
  const source="The company can reduce operating costs by reviewing supplier contracts and improving its purchasing process.";
  let seen;
  await selector.polishSentences(source,{language:"en",contextual:true,preview:true,preferFresh:true,limit:5,shortlist:2,
    generate:async()=>["By improving its purchasing process and reviewing supplier contracts, the company can lower operating costs."],
    semanticScore:async pairs=>pairs.map(()=>.97),
    score:async(texts,meta)=>{seen={texts,meta};return texts.map(()=>10)}});
  assert.equal(seen.texts[0],source);
  assert.ok(seen.texts.length<=3);assert.ok(seen.texts.length>1);
  assert.deepEqual(seen.meta.groups,[{offset:0,count:seen.texts.length}]);
});
test("shortlist cannot spend its slots on candidates outside the baseline quality budget",async()=>{
  const source="The company can reduce operating costs by reviewing supplier contracts and improving its purchasing process.";
  const candidate="By improving its purchasing process and reviewing supplier contracts, the company can lower operating costs.";
  const previous=globalThis.HumanizerMetrics;
  const metrics=require("./humanizer-metrics.js");
  globalThis.HumanizerMetrics={...metrics,scoreText:(text,language)=>({...metrics.scoreText(text,language),score:text===source?10:100})};
  try {
    let seen;
    await selector.polishSentences(source,{language:"en",contextual:true,preview:true,preferFresh:true,shortlist:2,
      generate:async()=>[candidate],semanticScore:async pairs=>pairs.map(()=>.97),
      score:async texts=>{seen=texts;return texts.map(()=>10)}});
    assert.deepEqual(seen,[source]);
  } finally { if(previous) globalThis.HumanizerMetrics=previous;else delete globalThis.HumanizerMetrics; }
});

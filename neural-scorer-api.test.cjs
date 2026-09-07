"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
function setup() {
  const workers = [], timers = new Map(); let timerId = 0;
  class Worker {
    constructor() { this.listeners = {}; workers.push(this); }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    postMessage(message) { this.last = message; }
    terminate() { this.terminated = true; }
    reply(message) { this.listeners.message({data:{id:this.last.id,...message}}); }
  }
  const element = () => ({classList:{toggle(){}},removeAttribute(){},addEventListener(){}});
  const ctx = vm.createContext({document:{querySelector:element},navigator:{gpu:{}},Worker,
    setTimeout(fn) { const id=++timerId; timers.set(id,fn); return id; },
    clearTimeout(id) { timers.delete(id); }});
  vm.runInContext(fs.readFileSync(require.resolve("./neural-scorer.js"),"utf8"),ctx);
  return {api:ctx.NeuralScorerUI,workers,timers};
}
test("scoreDetails transmits full-input intent and preserves incomplete results",async()=>{
  const {api,workers,timers}=setup();
  const pending=api.scoreDetails(["text"],{fullText:true,perplexityOnly:true});
  assert.equal(workers[0].last.fullText,true);
  assert.equal(workers[0].last.perplexityOnly,true);
  workers[0].reply({type:"scores",scores:[null],fullPair:false});
  assert.equal((await pending)[0],null);assert.equal(timers.size,0);
  assert.equal(api.warm(),false);
  const legacy=api.scoreTexts(["text"]);workers[0].reply({type:"scores",scores:[null]});
  assert.ok(Number.isNaN((await legacy)[0]));
});
test("cancellation rejects pending scoring and terminates its worker",async()=>{
  const {api,workers,timers}=setup();assert.equal(api.lockForPolish(),true);
  const pending=api.scoreDetails(["text"],{fullText:true});
  api.cancelPolishScoring();await assert.rejects(pending,/остановлена/);
  assert.equal(workers[0].terminated,true);assert.equal(timers.size,0);assert.equal(api.warm(),false);
});
test("timeout terminates scoring and allows a new worker on retry",async()=>{
  const {api,workers,timers}=setup();const pending=api.scoreDetails(["text"]);
  Array.from(timers.values())[0]();await assert.rejects(pending,/Истекло/);
  assert.equal(workers[0].terminated,true);assert.equal(timers.size,0);
  const retry=api.scoreDetails(["text"]);assert.equal(workers.length,2);
  workers[1].reply({type:"scores",scores:[]});await retry;
});
test("batch limit rejects before creating a worker",async()=>{
  const {api,workers}=setup();await assert.rejects(api.scoreDetails(Array(33).fill("x")),/много/);
  assert.equal(workers.length,0);
});

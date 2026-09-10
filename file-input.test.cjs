const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
  const pending=[],reports=[],applied=[],events={};const inputs=[0,1].map(i=>({value:'x',files:[],addEventListener(n,cb){events[i]=cb},click(){events.open=i}}));
  const root={DocumentReader:{readFile:async()=>''}};
  vm.runInNewContext(fs.readFileSync(require.resolve('./file-input.js'),'utf8'),{window:root});
  const load=root.DocumentFileInput.create({material:()=>({loadFile:()=>new Promise(resolve=>pending.push(resolve)),active:()=>false}),
    inputs,documentButton:{addEventListener(n,cb){events.doc=cb}},report:t=>reports.push(t),apply:(f,t)=>applied.push(t)});
  return{load,pending,reports,applied,inputs,events};
}
test('dedicated document button opens the DOCX picker without adding a third mode',()=>{const f=setup();f.events.doc();assert.equal(f.events.open,1)});
test('stale file completion does not overwrite the latest file status',async()=>{
  const f=setup(),a=f.load({name:'a.docx'}),b=f.load({name:'b.docx'});
  f.pending[1]('imported');await b;f.pending[0]('superseded');await a;
  assert.equal(f.reports.at(-1),'b.docx');assert.equal(f.applied.length,0);
});

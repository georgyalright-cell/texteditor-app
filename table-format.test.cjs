const test=require('node:test');
const assert=require('node:assert/strict');
const format=require('./table-format.js');
const processing=require('./material-processing.js');
global.AnchorGuard=require('./anchor-guard.js');
function fixture() {
  return {type:'docTable',columns:['Title',''],rows:[['2024','25%']],tableFormat:{version:1,style:{width:'400pt',backgroundColor:'#ffeeaa'},columnWidths:['100pt','300pt'],rows:[
    {header:false,cells:[{column:0,colSpan:2,rowSpan:1,text:'Title',style:{borderBottom:'2pt solid #000080',fontWeight:'bold'},paragraphs:[{runs:[{text:'Title',style:{fontStyle:'italic'}}]}]}]},
    {header:false,cells:[{column:0,text:'2024',style:{width:'100pt'}},{column:1,text:'25%',style:{width:'300pt',textAlign:'right'}}]}
  ]}};
}
test('rich table keeps widths, merged cells, colors, cell text and non-header first row',()=>{
  const block=fixture(),html=format.html(block);
  assert.match(html,/width:100pt/);assert.match(html,/width:300pt/);assert.match(html,/colspan="2"/);
  assert.match(html,/background-color:#ffeeaa/);assert.match(html,/font-style:italic/);assert.doesNotMatch(html,/<th/);
});
test('matrix/format drift, overlap and incomplete grid fail closed',()=>{
  const changed=fixture();changed.rows[0][1]='30%';assert.throws(()=>format.normalize(changed),/повреждены/);
  const overlap=fixture();overlap.tableFormat.rows[1].cells[1].column=0;assert.throws(()=>format.normalize(overlap));
  const hole=fixture();hole.tableFormat.rows[1].cells.pop();assert.throws(()=>format.normalize(hole));
});
test('untrusted CSS, fonts and content never become active markup',()=>{
  const block=fixture();block.tableFormat.style={width:'expression(alert(1))',backgroundColor:'url(https://example.test/leak)',fontFamily:'x; background:url(x)',position:'fixed'};
  block.columns[0]='<img src=x onerror=alert(1)>';
  const c=block.tableFormat.rows[0].cells[0];c.text=block.columns[0];c.paragraphs=[{runs:[{text:c.text,href:'javascript:alert(1)'}]}];
  const html=format.html(block);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|href=|expression\(|url\(|position:/);
});
test('base editing skips every table cell and preserves full format metadata',async()=>{
  const table=fixture(),source=[{type:'paragraph',text:'The company reports results.'},table];let calls=0;
  const result=await processing.base(source,{isCurrent:()=>true,progress(){},process(text){calls++;return{text:text.replace('reports','presents')};}});
  assert.equal(calls,1);assert.deepEqual(result.blocks[1],table);assert.match(result.blocks[0].text,/presents/);
});
test('model proposals only change prose; table formatting survives structured clone',()=>{
  const table=fixture(),before='The company reports results.',after='The company presents results.';
  const result=processing.accept([{type:'paragraph',text:before},table],[],[{start:0,end:before.length,before,after}]);
  assert.deepEqual(result.blocks[1],table);assert.equal(result.blocks[0].text,after);
});
test('native ZIP checkpoint bytes compare without expanding them into JSON',()=>{
  const {sameData}=require('./model-checkpoint.js');
  const a=[{sourceDocx:{bytes:new Uint8Array(1024*1024)},text:'unchanged'}];
  const b=structuredClone(a);assert.equal(sameData(a,b),true);
  b[0].sourceDocx.bytes[123]=1;assert.equal(sameData(a,b),false);
});
test('copying a native DOCX cannot silently discard original objects or page layout',async()=>{
  const copy=require('./document-clipboard.js');let writes=0;
  await assert.rejects(copy.copy([{type:'paragraph',text:'x',sourceDocx:{version:1}}],{clipboard:{writeText:async()=>{writes++;}}}),/скачайте DOCX/);
  assert.equal(writes,0);
});

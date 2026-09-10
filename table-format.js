(function attach(root) {
  "use strict";
  const LENGTH = /^(?:0|\d+(?:\.\d+)?(?:pt|px|cm|mm|in|%))$/u;
  const COLORS = { black:"#000000", white:"#ffffff", red:"#ff0000", blue:"#0000ff", green:"#008000", gray:"#808080", grey:"#808080", silver:"#c0c0c0", navy:"#000080", yellow:"#ffff00", transparent:"transparent" };
  const INHERITED = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "color", "textAlign", "lineHeight", "textDecoration"];
  const ENUMS = { textAlign:["left","center","right","justify"], verticalAlign:["top","middle","bottom"], fontWeight:["normal","bold"], fontStyle:["normal","italic"], textDecoration:["none","underline","line-through"], borderCollapse:["collapse","separate"], whiteSpace:["normal","pre-wrap"] };
  const LENGTH_KEYS = ["width","height","minHeight","fontSize","paddingTop","paddingBottom","paddingLeft","paddingRight","marginTop","marginBottom"];
  const BORDER_KEYS = ["borderTop","borderBottom","borderLeft","borderRight"];
  const escape = s => String(s ?? "").replace(/&/gu,"&amp;").replace(/</gu,"&lt;").replace(/>/gu,"&gt;").replace(/"/gu,"&quot;");
  function color(value) {
    const s=String(value || "").trim().toLowerCase();
    if (COLORS[s]) return COLORS[s];
    if (/^#[0-9a-f]{6}$/u.test(s)) return s;
    if (/^#[0-9a-f]{3}$/u.test(s)) return "#"+[...s.slice(1)].map(c=>c+c).join("");
    const rgb=/^rgb\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)\s*\)$/u.exec(s);
    return rgb && rgb.slice(1).every(n=>Number(n)<=255) ? "#"+rgb.slice(1).map(n=>Number(n).toString(16).padStart(2,"0")).join("") : "";
  }
  function length(value) {
    const s=String(value ?? "").trim().toLowerCase();
    return LENGTH.test(s) && parseFloat(s)<=30000 ? s : "";
  }
  function style(input = {}) {
    const out={};
    for (const key of LENGTH_KEYS) { const v=length(input[key]); if(v) out[key]=v; }
    for (const key of ["color","backgroundColor"]) { const v=color(input[key]); if(v) out[key]=v; }
    for (const [key,allowed] of Object.entries(ENUMS)) if(allowed.includes(input[key])) out[key]=input[key];
    if (typeof input.fontFamily === "string" && /^[\p{L}\p{N} ,_'"-]{1,100}$/u.test(input.fontFamily)) out.fontFamily=input.fontFamily;
    for (const key of BORDER_KEYS) {
      if (/^(none|hidden)$/u.test(input[key] || "")) { out[key]="none"; continue; }
      const m=/^(\S+)\s+(solid|dashed|dotted|double)\s+(.+)$/u.exec(input[key] || "");
      if(m && length(m[1]) && !m[1].endsWith("%") && color(m[3])) out[key]=`${length(m[1])} ${m[2]} ${color(m[3])}`;
    }
    const line=String(input.lineHeight ?? "");
    if (/^\d+(?:\.\d+)?$/u.test(line) && +line>0 && +line<=5) out.lineHeight=line;
    else if (length(line)) out.lineHeight=line;
    return out;
  }
  function matrix(block) { return block.type === "table" ? (block.lines || []).map(s=>s.split("\t")) : [block.columns,...block.rows]; }
  function normalize(block) {
    const f=block.tableFormat;
    if(!f) return null;
    const data=matrix(block), fail=()=>{ throw new Error("Структура или оформление таблицы повреждены. Исходная таблица не будет заменена упрощённой версией."); };
    if(f.version!==1 || !Array.isArray(f.rows) || f.rows.length!==data.length || data.length>1000 || !data[0]?.length || data[0].length>30 || data.some(r=>r.length!==data[0].length)) fail();
    const occupied=Array.from({length:data.length},()=>Array(data[0].length).fill(false));
    let runCount=0;
    const rows=f.rows.map((row,r)=>({header:row.header===true,style:style(row.style),cells:(Array.isArray(row.cells)?row.cells:fail()).map(cell=>{
      const c=cell.column, cs=cell.colSpan ?? 1, rs=cell.rowSpan ?? 1;
      if(![c,cs,rs].every(Number.isInteger) || c<0 || cs<1 || rs<1 || c+cs>data[0].length || r+rs>data.length || typeof cell.text!=="string" || data[r][c]!==cell.text) fail();
      for(let y=r;y<r+rs;y++) for(let x=c;x<c+cs;x++) {
        if(occupied[y][x] || ((y!==r || x!==c) && data[y][x]!=="")) fail(); occupied[y][x]=true;
      }
      const paragraphs=(cell.paragraphs || [{runs:[{text:cell.text}]}]).map(p=>({style:style(p.style),runs:(p.runs || []).map(run=>{
        if(typeof run.text!=="string" || ++runCount>30000) fail();
        return {text:run.text,style:style(run.style),...(/^https?:\/\/[^\s<>"\x00-\x1f]+$/iu.test(run.href || "") ? {href:run.href} : {})};
      })}));
      if(paragraphs.map(p=>p.runs.map(run=>run.text).join("")).join("\n")!==cell.text) fail();
      return {column:c,colSpan:cs,rowSpan:rs,text:cell.text,style:style(cell.style),paragraphs};
    }).sort((a,b)=>a.column-b.column)}));
    if(occupied.some(row=>row.some(v=>!v))) fail();
    return {version:1,style:style(f.style),columnWidths:Array.from({length:data[0].length},(_,i)=>length(f.columnWidths?.[i])),rows};
  }
  function css(input) { return Object.entries(style(input)).map(([k,v])=>`${k.replace(/[A-Z]/gu,c=>"-"+c.toLowerCase())}:${v}`).join(";"); }
  // Imported CSS is interpreted only as whitelisted values. Never mount an
  // imported node, stylesheet, URL, event handler or arbitrary CSS declaration.
  function fromHtml(table, doc) {
    if(table.querySelector("table,img,svg,math")) throw new Error("Вложенные таблицы, формулы и фото внутри ячеек пока не поддерживаются. Таблица не импортирована, чтобы не потерять её содержимое.");
    const rules=[];
    const tree=table.getRootNode();
    for(const sheet of tree.querySelectorAll("style")) {
      for(const m of sheet.textContent.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
        if(rules.length>=500) throw new Error("Слишком много правил оформления во вставке.");
        if(!m[1].includes("@")) rules.push([m[1].trim(),m[2]]);
      }
    }
    const cachedStyles=new WeakMap();
    function own(node) {
      if(cachedStyles.has(node)) return cachedStyles.get(node);
      const scratch=doc.createElement("span"); let declarations="";
      for(const [selector,body] of rules) { try { if(node.matches(selector)) declarations+=body+";"; } catch (_) {} }
      scratch.style.cssText=declarations+(node.getAttribute("style") || "");
      const s=scratch.style, out={};
      for(const k of [...LENGTH_KEYS,...INHERITED,...Object.keys(ENUMS),"backgroundColor",...BORDER_KEYS]) if(s[k]) out[k]=s[k];
      if(!out.width && /^\d+(?:\.\d+)?%?$/u.test(node.getAttribute("width") || "")) out.width=node.getAttribute("width")+(/%$/u.test(node.getAttribute("width"))?"":"px");
      if(node.hasAttribute("bgcolor") && !out.backgroundColor) out.backgroundColor=node.getAttribute("bgcolor");
      if(node.hasAttribute("align") && !out.textAlign) out.textAlign=node.getAttribute("align");
      if(node.hasAttribute("valign") && !out.verticalAlign) out.verticalAlign=node.getAttribute("valign");
      if(/^(B|STRONG)$/u.test(node.tagName)) out.fontWeight="bold";
      if(/^(I|EM)$/u.test(node.tagName)) out.fontStyle="italic";
      if(node.tagName==="U") out.textDecoration="underline";
      if(node.tagName==="TH") {out.fontWeight ||= "bold";out.textAlign ||= "center";}
      if(Number(out.fontWeight)>=600) out.fontWeight="bold";
      const result=style(out);cachedStyles.set(node,result);return result;
    }
    function inherited(node) {
      const path=[];for(let n=node.parentElement;n;n=n.parentElement) path.unshift(n);
      const result={}; for(const n of path) { const s=own(n);for(const k of INHERITED) if(s[k]) result[k]=s[k]; }
      return result;
    }
    function paragraphs(cell, defaults) {
      const result=[]; let current={style:{},runs:[]};
      const font=s=>Object.fromEntries(INHERITED.filter(k=>s[k]).map(k=>[k,s[k]]));
      const flush=()=>{if(current.runs.length) result.push(current);current={style:{},runs:[]};};
      function walk(n,base,href) {
        if(n.nodeType===3) { if(n.textContent) current.runs.push({text:n.textContent,style:base,...(href?{href}:{})});return; }
        if(n.nodeType!==1 || /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|FORM|INPUT|BUTTON|SVG|MATH)$/u.test(n.tagName)) return;
        if(n.tagName==="BR") {current.runs.push({text:"\n",style:base});return;}
        const direct=own(n), next={...base,...font(direct)}, boundary=/^(P|DIV|LI)$/u.test(n.tagName);
        if(boundary) {flush();current.style={...base,...direct};}
        for(const child of n.childNodes) walk(child,next,n.tagName==="A"?n.getAttribute("href"):href);
        if(boundary) { if(!current.runs.length) current.runs.push({text:"",style:next});flush(); }
      }
      for(const child of cell.childNodes) {if(child.nodeType===3 && !child.textContent.trim() && !current.runs.length) continue;walk(child,font(defaults));}
      flush();return result.length?result:[{style:{},runs:[{text:"",style:font(defaults)}]}];
    }
    const sourceRows=Array.from(table.querySelectorAll("tr"));
    if(!sourceRows.length || sourceRows.length>1000) throw new Error("Таблица должна содержать от 1 до 1000 строк.");
    const occupied=Array.from({length:sourceRows.length},()=>[]), values=sourceRows.map(()=>[]);
    const tableStyle={borderCollapse:"collapse",...inherited(table),...own(table)};
    const legacyBorder=Number(table.getAttribute("border"));
    const cellpadding=table.getAttribute("cellpadding");
    const rows=sourceRows.map((tr,r)=>{
      let column=0;const elements=Array.from(tr.children).filter(n=>/^(TD|TH)$/u.test(n.tagName));
      const header=tr.parentElement?.tagName==="THEAD" || elements.length>0 && elements.every(n=>n.tagName==="TH");
      const cells=elements.map(td=>{
        while(occupied[r][column]) column++;
        const cs=Number(td.getAttribute("colspan") || 1), rawRS=Number(td.getAttribute("rowspan") || 1), rs=rawRS===0?sourceRows.length-r:rawRS;
        if(![cs,rs].every(Number.isInteger) || cs<1 || rs<1 || column+cs>30 || r+rs>sourceRows.length) throw new Error("Некорректное объединение ячеек таблицы.");
        const cellStyle={...inherited(td),...own(td)};
        if(legacyBorder>0) for(const key of BORDER_KEYS) cellStyle[key] ||= `${Math.min(legacyBorder,10)}px solid #000000`;
        if(/^\d+$/u.test(cellpadding || "")) for(const key of ["paddingTop","paddingBottom","paddingLeft","paddingRight"]) cellStyle[key] ||= `${cellpadding}px`;
        const ps=paragraphs(td,cellStyle), text=ps.map(p=>p.runs.map(run=>run.text).join("")).join("\n");
        for(let y=r;y<r+rs;y++) for(let x=column;x<column+cs;x++) { if(occupied[y][x]) throw new Error("Объединённые ячейки перекрываются.");occupied[y][x]=true;values[y][x]=""; }
        values[r][column]=text;const cell={column,colSpan:cs,rowSpan:rs,text,style:cellStyle,paragraphs:ps};column+=cs;return cell;
      });
      return {header,style:own(tr),cells};
    });
    const count=Math.max(...values.map(r=>r.length));
    if(values.some(row=>row.length!==count || Array.from({length:count},(_,i)=>row[i]).some(v=>v===undefined))) throw new Error("Не удалось сохранить сетку таблицы: разное число ячеек.");
    const columnWidths=[];
    for(const col of table.querySelectorAll("colgroup > col, :scope > col")) for(let i=0;i<Math.min(30,Number(col.getAttribute("span"))||1);i++) columnWidths.push(own(col).width || "");
    for(const row of rows) for(const cell of row.cells) if(cell.colSpan===1 && cell.style.width) columnWidths[cell.column] ||= cell.style.width;
    const block={type:"docTable",columns:values[0],rows:values.slice(1),tableFormat:{version:1,style:tableStyle,columnWidths,rows}};
    block.tableFormat=normalize(block);return block;
  }
  function html(block) {
    const f=normalize(block);if(!f) throw new Error("Нет сохранённого оформления таблицы.");
    const attr=s=>css(s)?` style="${escape(css(s))}"`:"";
    const runs=p=>p.runs.map(r=>{const span=`<span${attr(r.style)}>${escape(r.text).replace(/\n/gu,"<br>")}</span>`;return r.href?`<a href="${escape(r.href)}">${span}</a>`:span;}).join("");
    const cols=f.columnWidths.some(Boolean)?`<colgroup>${f.columnWidths.map(w=>`<col${w?attr({width:w}):""}>`).join("")}</colgroup>`:"";
    return `<table data-preserved-table="1"${attr(f.style)}>${cols}${f.rows.map(row=>`<tr${attr(row.style)}>${row.cells.map(cell=>{
      const tag=row.header?"th":"td";return `<${tag} colspan="${cell.colSpan}" rowspan="${cell.rowSpan}"${attr(cell.style)}>${cell.paragraphs.map(p=>`<p${attr({marginTop:"0",marginBottom:"0",...p.style})}>${runs(p)}</p>`).join("")}</${tag}>`;
    }).join("")}</tr>`).join("")}</table>`;
  }
  function render(block,doc) {
    const f=normalize(block);
    const make=(tag,s)=>{const el=doc.createElement(tag);el.style.cssText=css(s);return el;};
    const table=make("table",f.style);table.dataset.preservedTable="1";
    if(f.columnWidths.some(Boolean)) {const group=doc.createElement("colgroup");for(const width of f.columnWidths) group.append(make("col",{width}));table.append(group);}
    for(const row of f.rows) {
      const tr=make("tr",row.style);
      for(const cell of row.cells) {
        const td=make(row.header?"th":"td",cell.style);td.colSpan=cell.colSpan;td.rowSpan=cell.rowSpan;
        for(const para of cell.paragraphs) {
          const p=make("p",{marginTop:"0",marginBottom:"0",...para.style});
          for(const run of para.runs) {const span=make("span",run.style);span.textContent=run.text;
            if(run.href) {const a=doc.createElement("a");a.href=run.href;a.rel="noreferrer noopener";a.target="_blank";a.append(span);p.append(a);} else p.append(span);}
          td.append(p);
        }
        tr.append(td);
      }
      table.append(tr);
    }
    return table;
  }
  const api={normalize,fromHtml,html,render,style,css,color,length};
  if(typeof module==="object" && module.exports) module.exports=api;
  root.TableFormat=api;
})(typeof window==="object"?window:globalThis);

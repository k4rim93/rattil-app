// QPC V2 (1421H Madani) page renderer. Builds an SVG shaped like the classic reader's pages
// (#content, .ayahPolygon with surah/ayah attributes, .ayah-mark) so the verse sheet, spotlight and taps keep working.
const FONT_BASE='https://fonts.quran.ws/assets/fonts/qpc-hafs-v2/';
const NS='http://www.w3.org/2000/svg';
const W=337.75,PX=4,VW=W+2*PX,H=550,LINES=15,TOP=6,BOT=4,FS0=21;
const mk=(t,a)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);return e};
let dataP=null;
export function loadQpc2Data(urls){return dataP||(dataP=Promise.all(urls.map(u=>fetch(u).then(r=>{if(!r.ok)throw new Error('qpc2 data '+r.status);return r.json()}))).then(([ay,...parts])=>({ay,p:Object.assign({},...parts)})).catch(e=>{dataP=null;throw e}))}
const fontP={};
const famOf=p=>'QCF2'+String(p).padStart(3,'0');
function loadFont(page){const fam=famOf(page);if(!fontP[page]){const f=new FontFace(fam,`url(${FONT_BASE}${fam}.ttf)`);fontP[page]=f.load().then(x=>{document.fonts.add(x);return fam}).catch(e=>{delete fontP[page];throw e})}return fontP[page]}
let cv=null;
function widthOf(fam,txt){cv=cv||document.createElement('canvas').getContext('2d');cv.font=`100px ${fam}`;return cv.measureText(txt).width}
export async function buildQpc2Svg(page,data,opts={}){
  const [fam]=await Promise.all([loadFont(page),page===1?0:loadFont(1)]);
  const pd=data.p[page];
  // viewport fit (same idea as the classic reader: tall phones get a taller viewBox and spread lines)
  const hostW=opts.hostW||0,hostH=opts.hostH||0;let vh=H,s=1;
  if(hostW&&hostH){const Hv=VW*hostH/hostW;if(Hv>H){vh=Hv;if(page>2)s=Math.max(1,Math.min(1.2,(0.86*Hv)/526))}}
  const off=(vh-H)/2,LH=(H-TOP-BOT)/LINES*s,top0=(H-LH*LINES)/2+(s>1?0:0)+off*0;
  const svg=mk('svg',{xmlns:NS,viewBox:`0 ${-off} ${VW} ${vh}`,'data-gq':'qpc2','data-qpc2':'1'});
  const content=mk('g',{id:'content'});svg.append(content);
  const marks=mk('g',{id:'ayah_markers'});svg.append(marks);
  const polys=new Map();let ai=pd.a;
  const slotY=i=>(s>1?(H-LH*LINES)/2:TOP)+i*LH;
  const FS=FS0*(s>1?1:1);
  pd.l.forEach((ln,idx)=>{
    const y0=slotY(idx),base=y0+LH*0.72;
    if(ln[0]==='h'){
      const g=mk('g',{class:'gq-banner qpc2-banner'});const y1=y0+LH*0.1,y2=y0+LH*0.9,x1=PX-1,x2=PX+W+1,r=(y2-y1)/2;
      g.append(mk('rect',{x:x1,y:y1,width:x2-x1,height:y2-y1,rx:r*0.45,class:'gq-b-out'}),mk('rect',{x:x1+3,y:y1+3,width:x2-x1-6,height:y2-y1-6,rx:r*0.35,class:'gq-b-in'}));
      for(const side of [0,1]){const cx=side?x2-r*1.5:x1+r*1.5,cy=(y1+y2)/2;g.append(mk('circle',{cx,cy,r:r*0.42,class:'gq-b-dot'}),mk('circle',{cx,cy,r:r*0.2,class:'gq-b-dot2'}))}
      const nm=mk('text',{x:(x1+x2)/2,y:cy0(y1,y2),direction:'rtl','text-anchor':'middle','font-size':r*1.0,class:'qpc2-surah-name','data-surah':ln[1]});nm.textContent=opts.surahName?opts.surahName(ln[1]):'';g.append(nm);
      content.append(g);return}
    if(ln[0]==='b'){
      const bw=data.p[1].l[1][1].split(' ').slice(0,4).map(w=>w.replace('|',''));const f1=famOf(1);
      const nat=bw.map(w=>widthOf(f1,w)*FS/100);const gap=2.2;const tot=nat.reduce((a,b)=>a+b,0)+gap*3;let x=PX+(W+tot)/2;
      const row=mk('g',{class:'qpc2-basmala'});bw.forEach((w,i)=>{const x0=x-nat[i];const t=mk('text',{x:x.toFixed(2),y:base.toFixed(2),'font-family':f1,'font-size':FS,direction:'rtl'});t.textContent=w;row.append(t);x=x0-gap});content.append(row);return}
    const words=ln[1].split(' ').map(w=>({t:w.replace('|',''),m:w.endsWith('|')}));
    const natural=words.map(w=>widthOf(fam,w.t)*FS/100);
    let fs=FS,nat=natural;const sum=natural.reduce((a,b)=>a+b,0),centered=ln[0]===1;
    if(sum>W){const k=W/sum;fs=FS*k;nat=natural.map(x=>x*k)}
    const used=nat.reduce((a,b)=>a+b,0);
    const gap=centered?(words.length>1?Math.min(2.2,0):0):(words.length>1?Math.max(0,(W-used)/(words.length-1)):0);
    const total=used+gap*(words.length-1);
    let x=PX+(centered?(W+total)/2:W);
    const row=mk('g',{});
    words.forEach((w,i)=>{
      const wd=nat[i],x0=x-wd;
      const t=mk('text',{x:x.toFixed(2),y:base.toFixed(2),'font-family':fam,'font-size':fs.toFixed(3),direction:'rtl'});t.textContent=w.t;row.append(t);
      const rect=[x0-(i<words.length-1?gap/2:0),y0,x+(i>0?gap/2:0),y0+LH];
      if(!polys.has(ai))polys.set(ai,[]);polys.get(ai).push(rect);
      if(w.m){const [sr,ay]=data.ay[ai];const mg=mk('g',{class:'ayah-mark','data-surah':sr,'data-ayah':ay});mg.append(mk('rect',{x:x0.toFixed(2),y:y0,width:wd.toFixed(2),height:LH,'fill-opacity':'0',fill:'#000'}));marks.append(mg);ai++}
      x=x0-gap;
    });
    content.append(row);
  });
  const polyG=mk('g',{id:'ayah_polygons'});
  for(const [k,rects] of polys){const [sr,ay]=data.ay[k];
    const byY=new Map();for(const r of rects){const kk=r[1].toFixed(1);const m=byY.get(kk);if(m){m[0]=Math.min(m[0],r[0]);m[2]=Math.max(m[2],r[2])}else byY.set(kk,[...r])}
    const d=[...byY.values()].map(r=>`M ${r[0].toFixed(2)} ${r[1].toFixed(2)} L ${r[2].toFixed(2)} ${r[1].toFixed(2)} L ${r[2].toFixed(2)} ${r[3].toFixed(2)} L ${r[0].toFixed(2)} ${r[3].toFixed(2)} Z`).join(' ');
    polyG.append(mk('path',{class:'ayahPolygon','fill-opacity':'0',id:'verse-'+(k+1),ayah:ay,surah:sr,d}))}
  svg.append(polyG);
  return svg;
}
function cy0(y1,y2){return ((y1+y2)/2+(y2-y1)*0.28).toFixed(2)}

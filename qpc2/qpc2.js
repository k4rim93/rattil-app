// QPC V2 (1421H Madani) page renderer. Builds an SVG shaped like the classic reader's pages
// (#content, .ayahPolygon with surah/ayah attributes, .ayah-mark) so the verse sheet, spotlight and taps keep working.
const FONT_BASE='https://fonts.quran.ws/assets/fonts/qpc-hafs-v2/';
const NS='http://www.w3.org/2000/svg';
const W=325,PX=10.7,VW=345.75,H=550,LINES=15,TOP=6,BOT=4,FS0=20.6,YSHIFT=0.0097;
const mk=(t,a)=>{const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);return e};
let dataP=null;
export function loadQpc2Data(urls){return dataP||(dataP=Promise.all(urls.map(u=>fetch(u).then(r=>{if(!r.ok)throw new Error('qpc2 data '+r.status);return r.json()}))).then(([ay,...parts])=>({ay,hd:{n:{}},p:Object.assign({},...parts)})).catch(e=>{dataP=null;throw e}))}
const AL='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
const decW=t=>{const o=[];for(let i=0;i<t.length;i+=2)o.push((AL.indexOf(t[i])*64+AL.indexOf(t[i+1]))*2);return o};
const fontP={};
const famOf=p=>'QCF2'+String(p).padStart(3,'0');
function loadFont(page){const fam=famOf(page);if(!fontP[page]){const f=new FontFace(fam,`url(${FONT_BASE}${fam}.ttf)`);fontP[page]=f.load().then(x=>{document.fonts.add(x);return fam}).catch(e=>{delete fontP[page];throw e})}return fontP[page]}
const hdP={};
const HDU=[new URL('./qpc2-hd0.json',import.meta.url).href,new URL('./qpc2-hd1.json',import.meta.url).href,new URL('./qpc2-hd2.json',import.meta.url).href,new URL('./qpc2-hd3.json',import.meta.url).href];
function loadHd(i){return hdP[i]||(hdP[i]=fetch(HDU[i]).then(r=>{if(!r.ok)throw new Error('qpc2 hd '+r.status);return r.json()}).catch(e=>{delete hdP[i];throw e}))}
async function ensureHd(data,pd){
  const need=new Set();for(const l of pd.l){if(l[0]==='b')need.add(0);if(l[0]==='h')need.add(0),need.add(1+Math.floor((l[1]-1)/38))}
  if(!need.size)return;
  const r=await Promise.all([...need].map(i=>loadHd(i).then(j=>[i,j])));
  for(const [i,j] of r){if(i===0){data.hd.s=j.s;data.hd.b=j.b}else Object.assign(data.hd.n,j)}
}
export async function buildQpc2Svg(page,data,opts={}){
  const [fam]=await Promise.all([loadFont(page),page===1?0:loadFont(1)]);
  const pd=data.p[page];await ensureHd(data,pd);
  // viewport fit (same idea as the classic reader: tall phones get a taller viewBox and spread lines)
  const hostW=opts.hostW||0,hostH=opts.hostH||0;let vh=H,s=1;
  if(hostW&&hostH){const Hv=VW*hostH/hostW;if(Hv>H){vh=Hv;if(page>2)s=Math.max(1,Math.min(1.2,0.001584*Hv))}}
  const off=(vh-H)/2,LH=(H-TOP-BOT)/LINES*s,top0=(H-LH*LINES)/2+(s>1?0:0)+off*0;
  const svg=mk('svg',{xmlns:NS,viewBox:`0 ${-off} ${VW} ${vh}`,'data-gq':'qpc2','data-qpc2':'1'});
  const content=mk('g',{id:'content'});svg.append(content);const deco=mk('g',{id:'qpc2-deco'});svg.append(deco);
  const marks=mk('g',{id:'ayah_markers'});svg.append(marks);
  const polys=new Map();let ai=pd.a;
  const SH=page===2?8:0,sp=page<=2,PP=41,nRows=pd.l.length,cb=H/2-(1.93+nRows-2)*PP/2;
  const slotY=i=>sp?(SH+cb+(i===0?0:(1.93+i-1)*PP)-PP/2):(s>1?(H-LH*LINES)/2+YSHIFT*vh:TOP)+i*LH;
  const FS=sp?24:FS0;const LHr=sp?PP:LH;
  pd.l.forEach((ln,idx)=>{
    const y0=slotY(idx),base=y0+LHr*0.72;
    if(ln[0]==='h'||ln[0]==='b'){
      const hd=data.hd;
      if(ln[0]==='h'){
        const g=mk('g',{class:'gq-banner qpc2-banner'});const bh=Math.min(33,LHr*0.85),y1=y0+(LHr-bh)/2+(sp?2:4),y2=y1+bh,x1=PX,x2=PX+W,cy=(y1+y2)/2,h=bh,E=58,F=E/44;
        g.append(mk('rect',{x:x1,y:y1,width:W,height:h,rx:2.6,class:'q2b-out'}));
        const lens=(xa,xb)=>`M${xa} ${cy-h*0.36}H${xb}A${h*0.36} ${h*0.36} 0 0 1 ${xb} ${cy+h*0.36}H${xa}A${h*0.36} ${h*0.36} 0 0 1 ${xa} ${cy-h*0.36}Z`;
        g.append(mk('path',{d:lens(x1+E*0.95,x2-E*0.95),class:'q2b-lens'}));
        for(const sd of [0,1]){
          const dir=sd?-1:1,ox=sd?x2:x1,P=(dx,dy)=>`${(ox+dir*dx*F).toFixed(2)} ${(cy+dy*h).toFixed(2)}`;
          const mx=ox+dir*14*F;
          g.append(mk('path',{class:'q2b-orn',d:`M${P(1.2,0)}Q${P(5,-.3)} ${P(11,-.36)}M${P(1.2,0)}Q${P(5,.3)} ${P(11,.36)}`}));
          for(const r of [h*.2,h*.12,h*.05])g.append(mk('circle',{cx:mx,cy,r,class:'q2b-orn'}));
          for(const v of [-1,1]){
            g.append(mk('path',{class:'q2b-orn',d:`M${P(20,v*.42)}C${P(27,v*.46)} ${P(33,v*.3)} ${P(31,v*.14)}C${P(30,v*.03)} ${P(26,v*.06)} ${P(27,v*.16)}`}));
            g.append(mk('path',{class:'q2b-orn',d:`M${P(21,v*.2)}C${P(25,v*.26)} ${P(27,v*.2)} ${P(25,v*.1)}`}));
            g.append(mk('path',{class:'q2b-orn',d:`M${P(10,v*.44)}C${P(12,v*.5)} ${P(16,v*.5)} ${P(17,v*.44)}`}));
          }
        }
        const A=hd.s,N=hd.n[ln[1]];const hh=h*0.8,k=hh/1024;const gap=25;
        const tot=(A[1]+gap+N[1])*k,sx=(x1+x2)/2+tot/2;
        const pa=mk('path',{d:A[0],class:'q2b-name',transform:`translate(${(sx-A[1]*k).toFixed(2)} ${(cy+hh*0.37).toFixed(2)}) scale(${k.toFixed(5)})`});
        const pn=mk('path',{d:N[0],class:'q2b-name',transform:`translate(${(sx-(A[1]+gap+N[1])*k).toFixed(2)} ${(cy+hh*0.37).toFixed(2)}) scale(${k.toFixed(5)})`});
        const gn=mk('g',{class:'qpc2-surah-name','data-surah':ln[1]});gn.append(pa,pn);g.append(gn);
        deco.append(g);return}
      if(page===2){
        const l1=data.p[1].l[1],bw=l1[1].split(' ').slice(0,4).map(w=>w.replace('|',''));const f1=famOf(1);const BF=22.7;
        const nat=decW(l1[2]).slice(0,4).map(v=>v*BF/1000);const gap=2.2;const tot=nat.reduce((a,b)=>a+b,0)+gap*3;let x=PX+(W+tot)/2+4;
        const row=mk('g',{class:'qpc2-basmala'});bw.forEach((w,i)=>{const x0=x-nat[i];const t=mk('text',{x:x.toFixed(2),y:(y0+LHr*0.72+1).toFixed(2),'font-family':f1,'font-size':BF,direction:'rtl'});t.textContent=w;row.append(t);x=x0-gap});content.append(row);return}
      const B=hd.b,k=(page<=2?142:188)/(B[2]-B[1]),cx=PX+W/2-2+(page<=2?6:0),cyb=y0+LHr*0.5+(page<=2?1.6:0);
      const pth=mk('path',{d:B[0],class:'qpc2-basmala-path',transform:`translate(${cx.toFixed(2)} ${cyb.toFixed(2)}) scale(${k.toFixed(5)}) translate(${-(B[1]+B[2])/2} ${-(B[3]+B[4])/2})`});
      const row=mk('g',{class:'qpc2-basmala'});row.append(pth);deco.append(row);return}
    const words=ln[1].split(' ').map(w=>({t:w.replace('|',''),m:w.endsWith('|')}));
    const natural=decW(ln[2]).map(v=>v*FS/1000);
    let fs=FS,nat=natural;const sum=natural.reduce((a,b)=>a+b,0),centered=ln[0]===1;
    if(sum>W){const k=W/sum;fs=FS*k;nat=natural.map(x=>x*k)}
    const used=nat.reduce((a,b)=>a+b,0);
    const gap=centered?(words.length>1?Math.min(2.2,0):0):(words.length>1?Math.max(0,(W-used)/(words.length-1)):0);
    const total=used+gap*(words.length-1);
    let x=PX+(centered?(W+total)/2:W);
    const row=mk('g',{});
    words.forEach((w,i)=>{
      const wd=nat[i],x0=x-wd;
      const t=mk('text',{x:x.toFixed(2),y:base.toFixed(2),'font-family':fam,'font-size':fs.toFixed(3),direction:'rtl'});t.textContent=w.t;
      if(w.m){t.setAttribute('style','fill:var(--q2ring);stroke:var(--q2ring)');t.setAttribute('class','q2-ring');row.append(t);
        const cid='q2c'+page+'_'+ai,cp=mk('clipPath',{id:cid});cp.append(mk('circle',{cx:(x0+wd/2).toFixed(2),cy:(base-fs*0.3).toFixed(2),r:(wd*0.3).toFixed(2)}));row.append(cp);
        const t2=mk('text',{x:x.toFixed(2),y:base.toFixed(2),'font-family':fam,'font-size':fs.toFixed(3),direction:'rtl','clip-path':'url(#'+cid+')',class:'q2-num'});t2.textContent=w.t;row.append(t2)}
      else row.append(t);
      const rect=[x0-(i<words.length-1?gap/2:0),y0,x+(i>0?gap/2:0),y0+LHr];
      if(!polys.has(ai))polys.set(ai,[]);polys.get(ai).push(rect);
      if(w.m){const [sr,ay]=data.ay[ai];const mg=mk('g',{class:'ayah-mark','data-surah':sr,'data-ayah':ay});mg.append(mk('rect',{x:x0.toFixed(2),y:y0,width:wd.toFixed(2),height:LHr,'fill-opacity':'0',fill:'#000'}));marks.append(mg);ai++}
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

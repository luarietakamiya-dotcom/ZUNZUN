import type { LayoutEnv } from './design-kit';
import type { MotionPack } from './types';
import { simplePack } from './fresh-packs';
import { oneCutPerLine } from '../mv-lines';

const variants = [
  ['soft','ソフト'],['spark','キラキラ粒子'],['glitch','グリッチ残光'],['lift','浮き上がる影'],
  ['mist','霧のピント'],['neon','ネオン点灯'],['ink','インク輪郭'],['gold','金色の残照'],
  ['wipe','光のグラデーション'],['film','フィルム露光'],
] as const;
type Kind = typeof variants[number][0];
const cap=(v:number)=>Math.max(0,Math.min(1,v));

function render(kind:Kind,env:LayoutEnv,split:(s:string,n:number)=>string|string[]){
  if(env.pass!=='main'||!env.cut.text)return null;
  const {W,H,ctx}=env, span=Math.max(.001,Math.min(.55,env.cut.dur*.26));
  const p=cap(Math.min(env.lt,env.cut.dur-env.lt)/span),a=p*p*(3-2*p),edge=1-a;
  if(!a)return null;
  const wrapped=split(env.cut.text,W<H?12:26),rows=Array.isArray(wrapped)?wrapped:wrapped.split('\n');
  ctx.save();
  try {
    const initial=Math.min(W,H)*.058;
    const font=(size:number)=>'600 '+size+'px sans-serif';
    ctx.font=font(initial);
    const longest=Math.max(1,...rows.map(s=>ctx.measureText(s).width));
    const size=initial*Math.min(1,W*.88/longest,H*.22/(rows.length*initial*1.32));
    ctx.font=font(size);ctx.textAlign='center';ctx.textBaseline='middle';
    const w=Math.max(...rows.map(s=>ctx.measureText(s).width)),x=W/2,y=H*.82;
    ctx.globalAlpha*=a;
    for(let i=0;i<rows.length;i++){
      const s=rows[i]!,cy=y+(i-(rows.length-1)/2)*size*1.32;
      ctx.save();
      ctx.shadowColor='#101018';ctx.shadowBlur=size*.09;ctx.fillStyle=env.sc.fg;
      if(kind==='glitch'&&edge){ctx.save();ctx.globalAlpha*=edge*.75;ctx.fillStyle='#00eeff';ctx.fillText(s,x-size*.1*edge,cy);ctx.fillStyle='#ff307c';ctx.fillText(s,x+size*.1*edge,cy);ctx.restore();}
      if(kind==='lift'){ctx.shadowOffsetY=size*.25*edge;ctx.shadowBlur=size*(.08+.23*edge);}
      if(kind==='mist')ctx.filter='blur('+size*.17*edge+'px)';
      if(kind==='neon'){ctx.shadowColor='#63ffff';ctx.shadowBlur=size*(.05+.42*edge);}
      if(kind==='ink'&&edge){ctx.lineWidth=size*.085*edge;ctx.strokeStyle='#91bcdf';ctx.strokeText(s,x,cy);}
      if(kind==='gold'){ctx.fillStyle='rgb(255,'+Math.round(255-78*edge)+','+Math.round(255-185*edge)+')';ctx.shadowColor='#ffb627';ctx.shadowBlur=size*.34*edge;}
      if(kind==='film'){ctx.shadowColor='#ffd9c7';ctx.shadowBlur=size*.65*edge;if(edge){ctx.save();ctx.globalAlpha*=edge;ctx.fillText(s,x,cy);ctx.restore();}}
      if(kind==='wipe'&&edge&&w>0){const g=ctx.createLinearGradient(x-w/2,0,x+w/2,0);g.addColorStop(0,'white');g.addColorStop(cap(a),'white');g.addColorStop(1,'rgba(255,255,255,'+a+')');ctx.fillStyle=g;}
      ctx.fillText(s,x,cy);ctx.restore();
    }
    if(kind==='spark'&&edge){ctx.fillStyle='#ffe39d';ctx.globalAlpha*=edge;for(let j=0;j<16;j++){const px=x+w*(Math.sin(j*12.7)*.5),py=y+size*Math.sin(j*7.3)*.82,r=size*.10*(.65+.35*Math.cos(j+p*5));ctx.fillRect(px-r,py-r*.16,r*2,r*.32);ctx.fillRect(px-r*.16,py-r,r*.32,r*2);}}
    return {x0:x-w/2,x1:x+w/2,y0:y-size*rows.length*.66,y1:y+size*rows.length*.66};
  }finally{ctx.restore();}
}

export const fadePacks:MotionPack[]=variants.map(([kind,name])=>({
  id:'visualsync-fade-'+kind,set:'vsFade'+kind,styleKey:'vs-fade-'+kind,
  effects:J=>[{group:'layout',key:'vsFadeLayout'+kind,def:{name:'字幕フェード・'+name,fits:()=>true,w:1,portrait:1,plan:()=>({}),render:(env:LayoutEnv)=>render(kind,env,(s,n)=>J.splitLines(s,n))}}],
  buildStyle(J){return {...simplePack.buildStyle(J),name:'字幕フェード・'+name,desc:'字幕の位置は固定。登場と退場だけに効果を付けます。',bias:{layout:{['vsFadeLayout'+kind]:10}}};},
  configure(project){project.fx={...(project.fx as object),motion:0,glitch:0,chroma:0,flash:false,decor:0,hud:'off',koma:0,onTwos:false};},
}));
export function prepareFade(plan:{cuts:unknown[]},key:string|undefined){
  const pack=fadePacks.find(p=>p.styleKey===key);if(!pack)return;
  oneCutPerLine(plan);
  for(const raw of plan.cuts){const c=raw as Record<string,unknown>;
    if(c.layout==='interlude')c.text='';
    Object.assign(c,{layout:'vsFadeLayout'+pack.styleKey.slice(8),params:{},cam:'none',camP:{},decor:[],bg:'none',trans:'none',morph:null});
  }
}

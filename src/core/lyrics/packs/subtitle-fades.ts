import type { LayoutEnv } from './design-kit';
import type { MotionPack } from './types';
import { simplePack } from './fresh-packs';
import { oneCutPerLine } from '../mv-lines';

const variants = [
  ['soft','ソフト'],['spark','キラキラ粒子'],['glitch','グリッチ残光'],['lift','浮き上がる影'],
  ['mist','霧のピント'],['neon','ネオン点灯'],['ink','インク輪郭'],['gold','金色の残照'],
  ['wipe','光のグラデーション'],['film','フィルム露光'],
  // 動きなし（2026-11-25 姫「MV字幕の場合、動きは何もなしに」「フェードだけ」）: 位置・大きさ・色は変えず、0.2 秒のフェードだけ
  ['plain','動きなし'],
] as const;
type Kind = typeof variants[number][0];
const cap=(v:number)=>Math.max(0,Math.min(1,v));
/** 「MV字幕・動きなし」のフェードの長さ（秒） */
export const PLAIN_FADE=.2;
/** 動きなしの縦長で 1 行に入れる文字数の目安: 日本語は 9 字、英字が中心の行は 16 字（単語で折り返すため） */
const plainPortraitPer=(t:string)=>(t.match(/[A-Za-z]/g)??[]).length>=[...t.replace(/\s/g,'')].length*.6?16:9;
const nameOf=(kind:Kind,name:string)=>kind==='plain'?'MV字幕・動きなし':'字幕フェード・'+name;

function render(kind:Kind,env:LayoutEnv,split:(s:string,n:number)=>string|string[]){
  if(env.pass!=='main'||!env.cut.text)return null;
  const {W,H,ctx}=env, span=Math.max(.001,Math.min(kind==='plain'?PLAIN_FADE:.55,env.cut.dur*.26));
  const p=cap(Math.min(env.lt,env.cut.dur-env.lt)/span),a=p*p*(3-2*p),edge=1-a;
  if(!a)return null;
  const wrapped=split(env.cut.text,W<H?(kind==='plain'?plainPortraitPer(env.cut.text):12):26),rows=Array.isArray(wrapped)?wrapped:wrapped.split('\n');
  ctx.save();
  try {
    // 動きなしの縦長は、1 行が短いぶん文字をひと回り大きくする（スマホの全画面で読みやすく）
    const initial=Math.min(W,H)*(kind==='plain'&&W<H?.07:.058);
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
  effects:J=>[{group:'layout',key:'vsFadeLayout'+kind,def:{name:nameOf(kind,name),fits:()=>true,w:1,portrait:1,plan:()=>({}),render:(env:LayoutEnv)=>render(kind,env,(s,n)=>J.splitLines(s,n))}}],
  buildStyle(J){return {...simplePack.buildStyle(J),name:nameOf(kind,name),desc:kind==='plain'?'字幕の位置・大きさ・色は固定。動きも効果もなく、0.2 秒のフェードで出入りします。':'字幕の位置は固定。登場と退場だけに効果を付けます。',bias:{layout:{['vsFadeLayout'+kind]:10}}};},
  configure(project){project.fx={...(project.fx as object),motion:0,glitch:0,chroma:0,flash:false,decor:0,hud:'off',koma:0,onTwos:false};},
}));
export function prepareFade(plan:{cuts:unknown[];events?:unknown[]},key:string|undefined){
  const pack=fadePacks.find(p=>p.styleKey===key);if(!pack)return;
  oneCutPerLine(plan);
  for(const raw of plan.cuts){const c=raw as Record<string,unknown>;
    if(c.layout==='interlude')c.text='';
    Object.assign(c,{layout:'vsFadeLayout'+pack.styleKey.slice(8),params:{},cam:'none',camP:{},decor:[],bg:'none',trans:'none',morph:null});
    // 動きなし: 登場・表示中・退場の動きも JIZURA の「カット」「静止」に固定する
    if(pack.styleKey==='vs-fade-plain')Object.assign(c,{enter:'cut',hold:'still',exit:'cut',treat:'none'});
  }
  // 動きなし: 拍に合わせた色ずれ（chroma）などの演出を外す。残すと表示中も画面が揺れる（2026-11-25 実測で約 5,500 画素が変化）
  if(pack.styleKey==='vs-fade-plain'&&Array.isArray(plan.events))plan.events.length=0;
}

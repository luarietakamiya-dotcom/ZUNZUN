import {store} from '../../core/store';
import {tr} from '../../core/i18n';
import {creditsFrom,fonts,type Credit} from '../../core/credits';
export function creditsCard(){
 const root=document.createElement('section');root.className='lyrics-card';
 const h=document.createElement('h3');h.textContent=tr('タイトル・アーティスト名','Titles and credits');root.append(h);
 const list=document.createElement('div');
 function btn(ja:string,en:string,fn:()=>void){const b=document.createElement('button');b.type='button';b.className='tab-button';b.textContent=tr(ja,en);b.onclick=fn;return b;}
 function add(t:number){if(store.credits.length>=128)return;const start=Math.max(0,t);store.setCredits([...store.credits,...creditsFrom([{title:tr('タイトル','Title'),start,end:Math.min(start+5,store.audio.duration||start+5)}])]);draw();}
 root.append(btn('冒頭に追加','Add at start',()=>add(0)),btn('再生位置に追加','Add at playhead',()=>add(store.audio.currentTime)),btn('曲末に追加','Add at end',()=>add(store.audio.duration-5)),list);
 function draw(){list.replaceChildren();store.credits.forEach((c,i)=>{
 const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=tr('表示枠 ','Credit ')+(i+1);box.append(legend);
 function patch(p:Partial<Credit>){store.setCredits(store.credits.map((v,j)=>j===i?{...v,...p}:v));}
 function label(s:string,input:HTMLElement){const l=document.createElement('label');l.style.display='inline-flex';l.style.gap='4px';l.style.margin='4px';l.append(s,input);box.append(l);}
 for(const key of ['title','artist'] as const){const f=document.createElement('input');f.maxLength=256;f.value=c[key];f.oninput=()=>patch({[key]:f.value});label(key==='title'?tr('曲名・見出し','Title'):tr('アーティスト・補足','Artist / subtitle'),f);}
 const sel=document.createElement('select');fonts.forEach((v,j)=>sel.add(new Option([tr('ゴシック','Sans serif'),tr('明朝','Serif'),tr('等幅','Monospace')][j]??v,v)));sel.value=c.font;sel.onchange=()=>patch({font:sel.value});label(tr('書体','Font'),sel);
 for(const [key,ja,en,min,max] of [['size','文字サイズ %','Text size %',25,250],['shadow','影','Shadow',0,18],['outline','ふちどり','Outline',0,10],['glow','発光','Glow',0,24]] as const){
 const f=document.createElement('input'),out=document.createElement('output');f.type='range';f.min=String(min);f.max=String(max);f.value=String(c[key]);out.value=f.value;f.oninput=()=>{out.value=f.value;patch({[key]:f.valueAsNumber});};label(tr(ja,en),f);box.append(out);}
 const color=document.createElement('input');color.type='color';color.value=c.glowColor;color.oninput=()=>patch({glowColor:color.value});label(tr('発光色','Glow color'),color);
 for(const [key,ja,en,max] of [['start','開始秒','Start (s)',86400],['end','終了秒','End (s)',86401],['fadeIn','フェードイン秒','Fade in (s)',60],['fadeOut','フェードアウト秒','Fade out (s)',60],['x','横位置 %','X %',100],['y','縦位置 %','Y %',100]] as const){
 const f=document.createElement('input');f.type='number';f.min='0';f.max=String(max);f.step='any';f.style.width='6em';f.value=String(c[key]);f.onchange=()=>{const n=f.valueAsNumber,v=store.credits[i];if(!v)return;if(!Number.isFinite(n)||n<0||n>max||(key==='end'&&n<=v.start)||(key==='start'&&n>=v.end)){f.value=String(v[key]);return;}patch({[key]:n});};label(tr(ja,en),f);}
 box.append(btn('ここを確認','Preview cue',()=>{const v=store.credits[i];if(v)store.audio.seek((v.start+v.end)/2);}),btn('削除','Remove',()=>{store.setCredits(store.credits.filter((_,j)=>j!==i));draw();}));list.append(box);
 });}draw();return root;
}

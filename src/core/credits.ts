export type Credit = { title:string; artist:string; start:number; end:number; x:number; y:number; fadeIn:number; fadeOut:number; font:string };
export const fonts = ['sans-serif','serif','monospace'] as const;
export function creditsFrom(raw:unknown): Credit[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0,128).flatMap(c=>{
    if (!c || typeof c !== 'object') return [];
    const num=(v:unknown,d:number,a:number,b:number)=>typeof v==='number' && Number.isFinite(v)?Math.min(b,Math.max(a,v)):d;
    const start=num(c.start,0,0,86400);
    return [{title:typeof c.title==='string'?c.title.slice(0,256):'',artist:typeof c.artist==='string'?c.artist.slice(0,256):'',start,end:num(c.end,start+5,start+.01,86401),x:num(c.x,50,0,100),y:num(c.y,50,0,100),fadeIn:num(c.fadeIn,.5,0,60),fadeOut:num(c.fadeOut,.5,0,60),font:fonts.includes(c.font)?c.font:'sans-serif'}];
  });
}
export function alpha(c:Credit,t:number){return t<c.start||t>=c.end?0:Math.min(1,c.fadeIn?(t-c.start)/c.fadeIn:1,c.fadeOut?(c.end-t)/c.fadeOut:1);}

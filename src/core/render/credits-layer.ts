import * as T from 'three';
import { alpha,type Credit } from '../credits';
export class CreditsLayer {
  items:Credit[]=[];
  private scene=new T.Scene();
  private cam=new T.OrthographicCamera(0,1,1,0,.1,10);
  private cache=new Map<Credit,T.Sprite>();
  constructor(){this.cam.position.z=1;}
  private release(s:T.Sprite){this.scene.remove(s);s.material.map?.dispose();s.material.dispose();}
  render(r:T.WebGLRenderer,t:number){
    for(const [c,s] of this.cache) if(!this.items.includes(c)||!alpha(c,t)){this.release(s);this.cache.delete(c);}
    for(const c of this.items){
      const opacity=alpha(c,t); if(!opacity||(!c.title&&!c.artist))continue;
      let s=this.cache.get(c);
      if(!s){
        const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')!;
        const rows=[[c.title,80],[c.artist,52]] as const;
        const lines=rows.filter(([v])=>v);
        const font=(size:number)=>'600 '+size+'px '+c.font;
        canvas.width=Math.min(4096,Math.ceil(Math.max(...lines.map(([v,n])=>{ctx.font=font(n);return ctx.measureText(v).width;})))+100);
        canvas.height=lines.reduce((sum,[,n])=>sum+n*1.4,96);
        ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillStyle='white';ctx.shadowColor='#111';ctx.shadowBlur=6;
        let y=48;for(const [v,n] of lines){ctx.font=font(n);const args=[v,canvas.width/2,y+n*.7,canvas.width-96] as const;
          if(c.glow){ctx.shadowColor=c.glowColor;ctx.shadowBlur=c.glow;ctx.fillStyle=c.glowColor;ctx.fillText(...args);ctx.fillText(...args);}
          ctx.shadowColor='#101018';ctx.shadowBlur=c.shadow;ctx.shadowOffsetY=c.shadow*.45;
          if(c.outline){ctx.lineJoin='round';ctx.strokeStyle='#101018';ctx.lineWidth=c.outline*2;ctx.strokeText(...args);}
          ctx.fillStyle='white';ctx.fillText(...args);ctx.shadowOffsetY=0;y+=n*1.4;}
        const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;
        s=new T.Sprite(new T.SpriteMaterial({map:tex,transparent:true,depthTest:false,depthWrite:false,toneMapped:false}));
        this.scene.add(s);this.cache.set(c,s);
      }
      const im=s.material.map!.image;
      const aspect=r.domElement.width/r.domElement.height;
      const k=Math.min(c.size/110000,.96*aspect/im.width);
      const w=im.width*k/aspect,h=im.height*k;
      s.scale.set(w,h,1);s.position.set(w/2+(1-w)*c.x/100,1-h/2-(1-h)*c.y/100,0);
      s.material.opacity=opacity;s.renderOrder=this.items.indexOf(c);
    }
    if(this.cache.size){const clear=r.autoClear;r.autoClear=false;try{r.render(this.scene,this.cam);}finally{r.autoClear=clear;}}
  }
  dispose(){for(const s of this.cache.values())this.release(s);this.cache.clear();}
}

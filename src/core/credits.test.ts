import {expect,it} from 'vitest';
import {alpha,creditsFrom} from './credits';
import {sanitizeProject} from './project/validate';
import {defaultProject} from './types';
it('keeps overlapping credits and computes independent fades on seek',()=>{
 const items=creditsFrom([{title:'曲名',artist:'歌手',start:0,end:5,fadeIn:2,fadeOut:1},{title:'制作',start:3,end:8,fadeIn:0}]);
 expect(sanitizeProject({...defaultProject(),credits:items}).credits).toEqual(items);
 const a=items[0]!,b=items[1]!;
 expect([alpha(a,0),alpha(a,1),alpha(a,4.5),alpha(a,5),alpha(b,4.5)]).toEqual([0,.5,.5,0,1]);
});

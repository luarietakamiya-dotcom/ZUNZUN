import { describe, expect, it } from 'vitest';
import { defaultComposition } from '../types';
import { framePlan, moveLayer, normalizeComposition } from './composition';

describe('レイヤーの順番', () => {
  it('動かす: 端では動かない', () => {
    const o = ['background', 'visualizer', 'lyrics', 'overlays'];
    expect(moveLayer(o, 'lyrics', -1)).toEqual(['background', 'lyrics', 'visualizer', 'overlays']);
    expect(moveLayer(o, 'overlays', 1)).toEqual(o);
    expect(moveLayer(o, 'background', -1)).toEqual(o);
    expect(moveLayer(o, 'nope', 1)).toEqual(o);
  });

  it('描き方: ビジュアライザーより奥が背景だけなら今までどおり (fast)、歌詞などが奥にあれば組み替え。隠したもの・無いものは描かない', () => {
    const all = () => true;
    expect(framePlan(defaultComposition(), all)).toEqual({ draw: ['background', 'visualizer', 'lyrics', 'overlays'], fast: true });
    const c = { ...defaultComposition(), order: ['background', 'lyrics', 'visualizer', 'overlays'] };
    expect(framePlan(c, all).fast).toBe(false);
    // 奥の歌詞を隠せば、また fast
    expect(framePlan({ ...c, hidden: ['lyrics'] }, all)).toEqual({ draw: ['background', 'visualizer', 'overlays'], fast: true });
    // ビジュアライザーが無い・隠している: 組み替え (画面を消してから奥から描く)
    expect(framePlan(defaultComposition(), (id) => id !== 'visualizer').fast).toBe(false);
    // 背景が無ければ、背景は描かない
    expect(framePlan(defaultComposition(), (id) => id !== 'background').draw).toEqual(['visualizer', 'lyrics', 'overlays']);
  });

  it('素材のレイヤー: 一覧に無い素材は捨て、順番に無い素材は手前に足す', () => {
    const c = normalizeComposition({ order: ['background', 'media:a', 'visualizer', 'media:gone'] }, { mediaIds: ['a', 'b'] });
    expect(c.order).toEqual(['background', 'media:a', 'visualizer', 'lyrics', 'overlays', 'media:b']);
  });
});

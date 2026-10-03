import { describe, expect, it } from 'vitest';
import { defaultProject } from '../../core/types';
import { visualizerRegistry } from '../index';
import { manifest, noneModule } from './index';

describe('「なし」(何も描かないビジュアライザー)', () => {
  it('manifest.empty で、何も描かないことを宣言する。先頭に登録され、新しいプロジェクトの既定になる', () => {
    expect(manifest.id).toBe('none');
    expect(manifest.empty).toBe(true);
    expect(visualizerRegistry.list()[0]!.id).toBe('none');
    expect(defaultProject().visualizer.preset).toBe('none');
    // ほかのプリセットは empty ではない
    expect(visualizerRegistry.list().filter((m) => m.empty).map((m) => m.id)).toEqual(['none']);
  });

  it('作っても、更新しても、大きさを変えても、片づけても何も起きない (シーンは空)', () => {
    const p = noneModule.create();
    p.init({} as never);
    p.update({ t: 0, dt: 0.016, bass: 1, mid: 1, high: 1, rms: 1, peak: 1, beat: 1, beatIndex: 0, spectralEnergy: 1, flux: 1, bands: new Float32Array(64) }, {} as never);
    p.resize(1280, 720);
    expect(p.scene.children).toHaveLength(0);
    expect(() => p.dispose()).not.toThrow();
  });
});

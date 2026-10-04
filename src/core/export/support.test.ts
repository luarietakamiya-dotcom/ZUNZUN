import { describe, expect, it } from 'vitest';
import { checkExportSupport } from './support';

describe('checkExportSupport', () => {
  it('映像と音声のエンコーダーが両方あれば ok', () => {
    expect(checkExportSupport({ VideoEncoder: class {}, AudioEncoder: class {} })).toEqual({ ok: true, missing: [] });
  });
  it('どちらかが無ければ、足りない名前を返す', () => {
    expect(checkExportSupport({ VideoEncoder: class {} })).toEqual({ ok: false, missing: ['AudioEncoder'] });
    expect(checkExportSupport({})).toEqual({ ok: false, missing: ['VideoEncoder', 'AudioEncoder'] });
  });
});

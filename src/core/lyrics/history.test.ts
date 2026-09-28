import { describe, expect, it } from 'vitest';
import { History } from './history';

describe('History', () => {
  it('取り消し・やり直し。新しく積むとやり直しの履歴は消える', () => {
    const h = new History(0);
    h.push(1);
    h.push(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.undo()).toBeNull();
    expect(h.current).toBe(0);
    expect(h.redo()).toBe(1);
    h.push(5);
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBeNull();
    expect(h.undo()).toBe(1);
  });

  it('上限を超えた古い履歴は捨てる', () => {
    const h = new History(0, 3);
    for (let i = 1; i <= 10; i++) h.push(i);
    let n = 0;
    while (h.undo() !== null) n++;
    expect(n).toBe(3);
    expect(h.current).toBe(7);
  });

  it('reset で履歴を捨てる', () => {
    const h = new History('a');
    h.push('b');
    h.reset('z');
    expect(h.current).toBe('z');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
});

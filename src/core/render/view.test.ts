import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { defaultView } from '../types';
import { applyView, isIdentityView, normalizeView, viewWindow } from './view';

describe('ビジュアライザーの見え方 (拡大・位置・傾き)', () => {
  it('壊れた値・範囲外の値を直す', () => {
    expect(normalizeView(null)).toEqual(defaultView());
    expect(normalizeView({ zoom: NaN, x: 5, y: -5, roll: 999 })).toEqual({ zoom: 1, x: 1, y: -1, roll: 180 });
    expect(normalizeView({ zoom: 0.01 }).zoom).toBe(0.5);
    expect(normalizeView({ zoom: 99 }).zoom).toBe(4);
    expect(isIdentityView(defaultView())).toBe(true);
  });

  it('見る窓: 2 倍なら画面の半分の大きさで、右上へずらすと窓も右上 (y は上から数える)', () => {
    expect(viewWindow({ zoom: 1, x: 0, y: 0, roll: 0 }, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    const w = viewWindow({ zoom: 2, x: 0.5, y: 0.5, roll: 0 }, 1920, 1080);
    expect(w.w).toBe(960);
    expect(w.h).toBe(540);
    expect(w.x + w.w / 2).toBe(1920 / 2 + 480);
    expect(w.y + w.h / 2).toBe(1080 / 2 - 270);
    // 1 より小さい拡大は、窓が画面より大きい (見える範囲が広がる)
    expect(viewWindow({ zoom: 0.5, x: 0, y: 0, roll: 0 }, 100, 100)).toEqual({ x: -50, y: -50, w: 200, h: 200 });
  });

  it('カメラに当てて、戻すと元どおり (見る窓も向きも)', () => {
    const cam = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    cam.position.set(1, 2, 3);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    const proj = cam.projectionMatrix.clone();
    const quat = cam.quaternion.clone();
    const restore = applyView(cam, { zoom: 2, x: 0.3, y: -0.2, roll: 30 }, 1920, 1080);
    expect(cam.view?.enabled).toBe(true);
    expect(cam.projectionMatrix.equals(proj)).toBe(false);
    expect(cam.quaternion.equals(quat)).toBe(false);
    // 視線の向きは変わらず、上の向きだけが回る
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    expect(dir.distanceTo(new THREE.Vector3(0, 0, -1).applyQuaternion(quat))).toBeLessThan(1e-6);
    restore();
    expect(cam.view?.enabled ?? false).toBe(false);
    expect(cam.projectionMatrix.equals(proj)).toBe(true);
    // roll の正 = 映る絵が反時計回り = カメラの上の向きが右へ倒れる
    const flat = new THREE.PerspectiveCamera();
    const r3 = applyView(flat, { zoom: 1, x: 0, y: 0, roll: 30 }, 100, 100);
    const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(flat.quaternion);
    expect(upv.x).toBeGreaterThan(0.4);
    r3();
    expect(cam.quaternion.angleTo(quat)).toBeLessThan(1e-9);
  });

  it('何も変えない見え方では何もしない。プリセットが自分で見る窓を使っていれば、その窓は触らない', () => {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    const proj = cam.projectionMatrix.clone();
    applyView(cam, defaultView(), 100, 100)();
    expect(cam.projectionMatrix.equals(proj)).toBe(true);
    cam.setViewOffset(200, 200, 10, 10, 100, 100);
    const own = cam.projectionMatrix.clone();
    const restore = applyView(cam, { zoom: 2, x: 0, y: 0, roll: 0 }, 100, 100);
    expect(cam.projectionMatrix.equals(own)).toBe(true);
    restore();
    expect(cam.view?.enabled).toBe(true);
    expect(cam.view?.offsetX).toBe(10);
  });

  it('正射影のカメラにも当てられる。見る窓の無いカメラでも傾きは当たる', () => {
    const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    const restore = applyView(ortho, { zoom: 2, x: 0, y: 0, roll: 0 }, 100, 100);
    expect(ortho.view?.enabled).toBe(true);
    restore();
    expect(ortho.view?.enabled ?? false).toBe(false);
    const plain = new THREE.Camera();
    const q = plain.quaternion.clone();
    const r2 = applyView(plain, { zoom: 3, x: 0, y: 0, roll: 90 }, 100, 100);
    expect(plain.quaternion.equals(q)).toBe(false);
    r2();
    expect(plain.quaternion.angleTo(q)).toBeLessThan(1e-9);
  });
});

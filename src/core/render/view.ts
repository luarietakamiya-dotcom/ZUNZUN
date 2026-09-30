import * as THREE from 'three';
import { defaultView, VIEW_ZOOM_MAX, VIEW_ZOOM_MIN, type ViewSettings } from '../types';

/**
 * ビジュアライザーの見え方 (拡大・位置・傾き。ViewSettings) を、プリセットのカメラに一時的に当てる。
 * - 拡大・位置: カメラの「見る窓」(camera.setViewOffset)。大きな画面の一部だけを描くので、拡大しても粗くならない。
 *   1 より小さい拡大は、窓を画面より大きくする = 見える範囲が広がる
 * - 傾き: カメラを視線の軸のまわりに回す
 * プリセットはカメラを毎フレーム自分で動かすので、描く直前に当てて、描いたら元に戻す (プリセットの状態を汚さない)。
 */

const clampNum = (v: number, a: number, b: number, fallback: number): number => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : fallback);

/** 壊れた値を直した見え方 */
export function normalizeView(v: Partial<ViewSettings> | null | undefined): ViewSettings {
  const d = defaultView();
  if (!v) return d;
  return {
    zoom: clampNum(Number(v.zoom), VIEW_ZOOM_MIN, VIEW_ZOOM_MAX, d.zoom),
    x: clampNum(Number(v.x), -1, 1, d.x),
    y: clampNum(Number(v.y), -1, 1, d.y),
    roll: clampNum(Number(v.roll), -180, 180, d.roll),
  };
}

/** 何も変えない見え方か */
export function isIdentityView(v: ViewSettings): boolean {
  return v.zoom === 1 && v.x === 0 && v.y === 0 && v.roll === 0;
}

/** 画面 (W×H) に対する見る窓 (camera.setViewOffset の x, y, 幅, 高さ。y は上から) */
export function viewWindow(v: ViewSettings, W: number, H: number): { x: number; y: number; w: number; h: number } {
  const w = W / v.zoom;
  const h = H / v.zoom;
  const cx = W / 2 + (v.x * W) / 2;
  const cy = H / 2 - (v.y * H) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

type ViewCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;
const hasViewOffset = (c: THREE.Camera): c is ViewCamera =>
  (c as Partial<THREE.PerspectiveCamera>).isPerspectiveCamera === true || (c as Partial<THREE.OrthographicCamera>).isOrthographicCamera === true;

/**
 * 見え方をカメラに当てる。戻り値を呼ぶと元に戻る。何も変えない見え方なら何もしない。
 * プリセットが自分で見る窓を使っているカメラには、拡大・位置は当てない (傾きだけ)。
 */
export function applyView(camera: THREE.Camera, view: ViewSettings, W: number, H: number): () => void {
  if (isIdentityView(view) || !(W > 0) || !(H > 0)) return () => {};
  const quat = camera.quaternion.clone();
  let restoreView: (() => void) | null = null;
  if (hasViewOffset(camera) && !(camera.view && camera.view.enabled) && (view.zoom !== 1 || view.x !== 0 || view.y !== 0)) {
    const win = viewWindow(view, W, H);
    camera.setViewOffset(W, H, win.x, win.y, win.w, win.h);
    restoreView = () => camera.clearViewOffset();
  }
  if (view.roll !== 0) {
    // カメラを時計回りに回すと、映る絵は反時計回りに回る (roll の正 = 絵が反時計回り)
    camera.rotateZ(-THREE.MathUtils.degToRad(view.roll));
    camera.updateMatrixWorld();
  }
  return () => {
    restoreView?.();
    camera.quaternion.copy(quat);
    camera.updateMatrixWorld();
  };
}

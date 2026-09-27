import * as THREE from 'three';

/**
 * Solar Gate が使うグラデーションテクスチャを、canvas を使わず配列から直接作る。
 * (canvas 2D が無い環境 = Vitest/jsdom でも同じものが作れ、ピクセル単位で決定論的になる)
 */

function makeTexture(width: number, height: number, alphaAt: (u: number, v: number) => number): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height;
      const a = Math.round(Math.max(0, Math.min(1, alphaAt(u, v))) * 255);
      const i = (y * width + x) * 4;
      data[i] = a;
      data[i + 1] = a;
      data[i + 2] = a;
      data[i + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** 中心が明るく外周に向かって滑らかに消える丸 (粒子・星・床の光だまり用)。 */
export function makeRadialTexture(size = 64): THREE.DataTexture {
  return makeTexture(size, size, (u, v) => {
    const r = Math.hypot(u - 0.5, v - 0.5) * 2;
    return Math.pow(Math.max(0, 1 - r), 2.2);
  });
}

/**
 * 光線 1 本ぶんの形。v=0 (根元) が明るく先端に向かって消え、横方向は中心線が明るい。
 * 光線の Mesh は根元を原点に +Y へ伸びるので、この v がそのまま「根元からの距離」になる。
 */
export function makeRayTexture(): THREE.DataTexture {
  return makeTexture(16, 64, (u, v) => {
    const across = Math.exp(-Math.pow((u - 0.5) * 4.2, 2));
    const along = Math.pow(1 - v, 1.6) * Math.min(1, v * 14);
    return across * along;
  });
}

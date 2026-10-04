import * as THREE from 'three';

/** 半径方向に並べる、スペクトルの帯の数 (中心 = 低音 → 外 = 高音) */
export const KALEIDO_BANDS = 16;

/**
 * 万華鏡を、全画面の板 1 枚で式から描く (座標は画面の高さの半分 = 1、中心は画面の中心)。
 * 2026-10-04 ユーザーが実物の万華鏡の写真 3 枚 (くっきりした多面体のガラス片、濃い色、縁の暗い線と光る線、虹色のにじみ) を見せて
 * 「こんなのがいい」→ にじんだ丸い模様から、ガラス片の描き方に作り直した。
 * 1. 角度を 1 枚の扇形 (360° / 枚数) に折りたたむ (鏡写し)。鏡の継ぎ目はなめらかにつながる
 * 2. 折りたたんだ座標に、ボロノイ分割で多面体のガラス片を並べる。破片ごとに色 (4 色から)・面の明るさ・透け具合が違い、
 *    ゆっくり漂って回る (万華鏡の中の破片が動く)。縁は暗い線と、そのすぐ内側の光る線。大小 2 層を半透明に重ねて奥行きを出す
 * 3. 光る細い曲線と、その上を流れる金色の粒の列 (写真の、白い曲線と粒の連なり。鏡の継ぎ目の上に置いたハートが折り返されて、完全なハートが中心のまわりに並ぶ)。縁に虹色のにじみ (高音で強まる)。高音で一部の破片がきらめく
 * 4. 半径ごとに、スペクトルの帯の強さで明るさを変える (中心が低音、外が高音)。中心に宝石のような光 (低音でふくらむ)
 * 最後に明るさをやわらかく丸める (広い面積が白く飛ばないように)。
 */
export function createKaleidoscopeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Kaleidoscope',
    depthTest: false,
    depthWrite: false,
    uniforms: {
      aspect: { value: 16 / 9 },
      t: { value: 0 },
      rot: { value: 0 },
      zoom: { value: 1 },
      warp: { value: 0.5 },
      seg: { value: 6 },
      detail: { value: 1 },
      mood: { value: 0 },
      tone: { value: 0.5 },
      sparkle: { value: 0.5 },
      bass: { value: 0 },
      high: { value: 0 },
      bandLevel: { value: new Float32Array(KALEIDO_BANDS) },
      intensity: { value: 1 },
      colA: { value: new THREE.Color() },
      colB: { value: new THREE.Color() },
      colC: { value: new THREE.Color() },
      colD: { value: new THREE.Color() },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #define NB ${KALEIDO_BANDS}
      uniform float aspect;
      uniform float t;
      uniform float rot;
      uniform float zoom;
      uniform float warp;
      uniform float seg;
      uniform float detail;
      uniform float mood; // 曲調: 0 = 静か・おだやか、1 = 激しい・にぎやか (ゆっくり変わる)
      uniform float tone; // 音の明るさ (0 = 低い音が中心、1 = 高い音が中心。ゆっくり変わる)
      uniform float sparkle; // キラキラの量 (設定。0 = 出さない)
      uniform float bass;
      uniform float high;
      uniform float bandLevel[NB];
      uniform float intensity;
      uniform vec3 colA;
      uniform vec3 colB;
      uniform vec3 colC;
      uniform vec3 colD;
      varying vec2 vUv;

      /** 同じ入力なら同じ値になる、ばらつき用の hash (乱数ではない) */
      float hash1(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      vec2 hash2(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return fract(sin(p) * 43758.5453);
      }

      /** 半径 r (0..1.4) に対応する帯の強さ (隣の帯となめらかにつなぐ) */
      float levelAt(float r) {
        float x = clamp(r / 1.4, 0.0, 1.0) * float(NB - 1);
        int i = int(floor(x));
        float f = fract(x);
        return mix(bandLevel[i], bandLevel[min(i + 1, NB - 1)], f);
      }

      /** ボロノイ: 点を中心にゆっくり漂わせ、いちばん近い点までの距離 (f1)・境目までの近さ (edge)・破片の番号 (cell)・破片の中の位置 (loc) を返す */
      void voro(vec2 x, float tm, out float f1, out float edge, out vec2 cell, out vec2 loc) {
        vec2 n = floor(x);
        vec2 f = fract(x);
        float d1 = 8.0;
        float d2 = 8.0;
        cell = vec2(0.0);
        loc = vec2(0.0);
        for (int j = -1; j <= 1; j++) {
          for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = hash2(n + g);
            o = 0.5 + 0.42 * sin(tm + 6.2831853 * o);
            vec2 r = g + o - f;
            float d = dot(r, r);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              cell = n + g;
              loc = r;
            } else if (d < d2) {
              d2 = d;
            }
          }
        }
        f1 = sqrt(d1);
        edge = sqrt(d2) - sqrt(d1);
      }

      /** 破片の色 (4 色から 1 つ。破片ごとに決まる) */
      vec3 pickColor(float h) {
        vec3 c = colA;
        c = mix(c, colB, step(0.25, h));
        c = mix(c, colC, step(0.5, h));
        c = mix(c, colD, step(0.75, h));
        return c;
      }

      /** ガラス片 1 層: 色・面の明るさ・縁の暗い線と光る線 */
      vec3 shards(vec2 q, float tm, float seed) {
        float f1;
        float edge;
        vec2 cell;
        vec2 loc;
        voro(q, tm, f1, edge, cell, loc);
        float h = hash1(cell + seed);
        float h2 = hash1(cell * 1.7 + seed + 9.1);
        float h3 = hash1(cell * 2.3 + seed + 4.7);
        vec3 base = pickColor(h);
        // 面の明るさ: 破片ごとに光の向きが違い、面の中で明るさが傾く (切り子のような面)
        vec2 ldir = vec2(cos(h2 * 6.2831853), sin(h2 * 6.2831853));
        float lit = 0.62 + 0.9 * dot(loc, ldir) * (0.6 + 0.6 * h3);
        // 透け具合: 破片ごとに濃さが違う (濃い宝石 ↔ 薄いガラス)
        float depth = 0.45 + 0.85 * h3;
        vec3 c = base * clamp(lit, 0.15, 1.6) * depth;
        // 縁: 暗い線 + そのすぐ内側の光る線 (一部の破片だけ強く光る)
        float dark = smoothstep(0.0, 0.085, edge);
        c *= mix(0.05, 1.0, dark);
        float rim = exp(-pow((edge - 0.09) / 0.035, 2.0));
        c += mix(base, vec3(1.0), 0.22) * rim * (0.12 + 0.55 * step(0.55, h2));
        // 破片の真ん中のきらめき (高音で一部の破片が光る。破片ごとに位相が違う)
        float tw = max(0.0, sin(t * (2.0 + 3.0 * h) + h2 * 40.0));
        c += vec3(1.0, 0.95, 0.85) * exp(-f1 * f1 * 90.0) * step(0.7, h3) * (0.1 + 0.9 * tw * high);
        return c;
      }

      float dot2(vec2 v) {
        return dot(v, v);
      }
      /** ハート形までの符号つき距離 (先端が原点、ふくらみが上。幅は約 ±0.5、高さは約 1) */
      float sdHeart(vec2 p) {
        p.x = abs(p.x);
        if (p.y + p.x > 1.0) return sqrt(dot2(p - vec2(0.25, 0.75))) - 0.35355339;
        return sqrt(min(dot2(p - vec2(0.0, 1.0)), dot2(p - 0.5 * max(p.x + p.y, 0.0)))) * sign(p.x - p.y);
      }
      /**
       * ハート 1 つ分の光る輪郭と、輪郭に沿って流れる粒 (x = 曲線の光、y = 粒の光)。
       * pl = ハートの座標 (大きさで割ってある)、size = ハートの大きさ (画面の高さの半分 = 1)。
       * 粒は、ハートの中心まわりの角度で等間隔に並べる
       */
      vec2 heartOrnament(vec2 pl, float size, float nb, float spd, float bw) {
        float sd = sdHeart(pl) * size;
        float curve = exp(-pow(sd / 0.006, 2.0)) + 0.22 * exp(-pow(sd / 0.03, 2.0));
        vec2 pc = pl - vec2(0.0, 0.45);
        float sp = 6.2831853 / nb;
        float u = atan(pc.y, pc.x) + t * spd;
        float lu = (fract(u / sp + 0.5) - 0.5) * sp * length(pc) * size;
        float bead = exp(-(lu * lu + sd * sd) / (bw * bw));
        return vec2(curve, bead);
      }

      /**
       * 光る曲線と、その上を流れる粒の列 (実物の万華鏡の写真の、細い白い曲線と金色の粒の連なり)。
       * 円 1 つ分: x = 曲線の光 (細い線 + うすいにじみ)、y = 粒の光 (等間隔の小さな粒が円に沿ってゆっくり流れる)。
       * 折りたたんだ扇形の中に置くので、円弧が鏡で折り返され、中心のまわりの環につながる (ハートは heartOrnament)
       */
      vec2 ringOrnament(vec2 fp, vec2 c, float rad0, float nb, float spd, float bw) {
        vec2 d = fp - c;
        float rad = length(d);
        float dd = rad - rad0;
        float curve = exp(-pow(dd / 0.006, 2.0)) + 0.22 * exp(-pow(dd / 0.03, 2.0));
        float sp = 6.2831853 / nb;
        float u = atan(d.y, d.x) + t * spd;
        float lu = (fract(u / sp + 0.5) - 0.5) * sp * rad0;
        float bead = exp(-(lu * lu + dd * dd) / (bw * bw));
        return vec2(curve, bead);
      }

      /**
       * キラキラ: 小さな星のきらめき (中心の光の点 + 縦横にのびる光条)。格子の目ごとに星があり (一部だけ)、
       * それぞれ別のタイミングで短くまたたく。向きもゆっくり回る。大小 2 つの格子を重ねる。
       * 折りたたんだ扇形の座標で描くので、鏡写しで左右対称に増える
       */
      float glint(vec2 fp, float grid, float seed) {
        vec2 g = fp * grid;
        vec2 cell = floor(g);
        vec2 d = fract(g) - 0.5;
        float h = hash1(cell + seed);
        d -= (hash2(cell + seed + 3.1) - 0.5) * 0.6;
        float ang = t * 0.25 + h * 6.2831853;
        float ca = cos(ang);
        float sa = sin(ang);
        d = vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y);
        float phase = t * (1.4 + 2.2 * h) + h * 57.0;
        float tw = pow(max(0.0, sin(phase)), 5.0); // 短く光ってまた暗くなる
        float core = exp(-dot(d, d) * 130.0);
        float arms = exp(-abs(d.x) * 7.0 - abs(d.y) * 150.0) + exp(-abs(d.y) * 7.0 - abs(d.x) * 150.0);
        return (core * 1.4 + 0.9 * arms) * tw * step(0.5, h);
      }

      void main() {
        vec2 p = vec2((vUv.x - 0.5) * 2.0 * aspect, (vUv.y - 0.5) * 2.0) / zoom;
        float r = length(p);
        // 鏡: 角度を 1 枚の扇形に折りたたむ
        float a = atan(p.y, p.x) + rot;
        float s = 6.2831853 / seg;
        a = mod(a, s);
        a = abs(a - 0.5 * s);
        // 扇形の中の見る場所は、ゆっくり動く (万華鏡の中の物が動く)。静かな曲は大きな破片、激しい曲は細かい破片
        float scale = 2.1 * detail * (0.8 + 0.7 * mood);
        vec2 q = (r * vec2(cos(a), sin(a)) + vec2(0.55, 0.25) + warp * 0.35 * vec2(sin(t * 0.11), cos(t * 0.09))) * scale;
        float tm = t * (0.25 + 0.35 * mood);
        // 大きな破片 + 小さな破片を半透明に重ねる (激しい曲ほど 2 層目が強い)
        vec3 col = shards(q, tm, 0.0);
        vec3 col2 = shards(q * 1.9 + vec2(3.7, 1.3), tm * 1.3, 17.0);
        col = mix(col, col2 * 1.1, 0.12 + 0.3 * mood); // 半透明に重ねる (足し算にすると色が白く薄くなる)
        // 縁の虹色のにじみ (高音で強まる): 破片の境目のあたりに、角度で色相が回る薄い光
        float f1x;
        float ex;
        vec2 cx;
        vec2 lx;
        voro(q, tm, f1x, ex, cx, lx);
        vec3 spectrum = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67) + a / 3.1415926 + t * 0.05 + r));
        col += spectrum * exp(-pow(ex / 0.05, 2.0)) * (0.05 + 0.3 * high) * (0.4 + 0.6 * mood);
        // 音の明るさ: 高い音が中心なら青っぽく、低い音が中心なら赤っぽく (ほんの少し。ゆっくり変わる)
        col *= vec3(1.0 - 0.18 * (tone - 0.5), 1.0, 1.0 + 0.18 * (tone - 0.5));
        // 光る曲線と粒の列 (折りたたんだ扇形の座標 fp に、大小 3 つの円。低音でわずかに伸び縮み。静かな曲は控えめ、激しい曲ほどはっきり)
        vec2 fp = r * vec2(cos(a), sin(a));
        float swell = 1.0 + 0.05 * bass;
        // ハート 2 組: 内側の小さなハート (先端が中心向き) と、外側の大きなハート (先端が外向き)。
        // 鏡の継ぎ目の上に置くので、折り返されて完全なハートになる。枚数が多い (扇形が細い) ほど小さくする
        float wf = clamp(tan(0.5 * s) / 0.5774, 0.35, 1.6);
        vec2 fpb = r * vec2(cos(0.5 * s - a), sin(0.5 * s - a)); // もう一方の継ぎ目の側から見た座標
        float sz1 = 0.30 * wf * swell;
        float sz2 = 0.5 * wf * swell;
        vec2 o1 = heartOrnament(vec2(fp.y, fp.x - 0.5) / sz1, sz1, 22.0, 0.35, 0.02);
        vec2 o2 = heartOrnament(vec2(fpb.y, -(fpb.x - 1.45)) / sz2, sz2, 30.0, -0.25, 0.017);
        vec2 o3 = ringOrnament(fp, vec2(0.28 + 0.03 * sin(t * 0.23), 0.04), 0.17 * swell, 12.0, 0.5, 0.022);
        float curves = o1.x + 0.8 * o2.x + o3.x;
        float beads = o1.y + 0.9 * o2.y + 1.1 * o3.y;
        col += mix(colB, vec3(1.0), 0.65) * curves * (0.42 + 0.5 * mood);
        col += mix(colD, vec3(1.0, 0.92, 0.65), 0.55) * beads * (0.3 + 0.7 * mood) * (0.7 + 0.8 * high);
        // キラキラ (設定の量。高音で増える。大小 2 つの格子)
        float gl = glint(fp, 5.0, 1.0) + 0.7 * glint(fp, 9.0, 7.0);
        col += mix(colC, vec3(1.0, 0.97, 0.9), 0.7) * gl * sparkle * 1.7 * (0.5 + 0.9 * high + 0.4 * mood);
        // 半径ごとの帯の強さ (静かなときも形は見える)
        col *= 0.55 + 0.9 * levelAt(r);
        // 中心の宝石
        col += colD * exp(-r * r * 12.0) * (0.12 + 0.6 * bass);
        // 端をなだらかに暗く
        col *= smoothstep(3.4, 0.9, r);
        // 濃い宝石のような色にする (薄い・白っぽいと実物のガラスらしくない)
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = max(vec3(0.0), mix(vec3(lum), col, 1.45));
        col = col / (1.0 + 0.8 * col);
        gl_FragColor = vec4(col * intensity, 1.0);
      }
    `,
  });
}

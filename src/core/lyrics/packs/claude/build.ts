import type { MotionPack, PackEffect, PackJ, PackScheme } from '../types';

/**
 * Claude 版リリックモーション（スタイル名・キーの語尾 `.c`）の土台。
 * 競作の取り決め: docs/AI_COLLABORATION.md「競作の取り決め」。設計の土台: docs/LYRIC_MOTION_RESEARCH.md。
 * 既存のパック（kinetic-packs の themed）と同じ仕組みで、独立した部品セットを持つ。
 */
export interface ClaudeSpec {
  /** 英字の識別子（例: 'Hyper'）。styleKey は `vs-hyper.c`、部品セットは `vsc-hyper` */
  id: string;
  /** 画面に出る名前（語尾 .c は自動で付く） */
  name: string;
  desc: string;
  fonts: { display: string[]; serif: string[]; body: string[] };
  scheme: PackScheme & { ink?: string };
  effects: (J: PackJ) => PackEffect[];
}

export function claudePack(spec: ClaudeSpec): MotionPack {
  const set = `vsc-${spec.id.toLowerCase()}`;
  const own = (J: PackJ): PackEffect[] => {
    const list = spec.effects(J);
    if (!list.some((e) => e.group === 'cam')) list.push({ group: 'cam', key: `vsc${spec.id}Fixed`, def: { name: 'カメラ固定.c', get: () => ({ s: 1, x: 0, y: 0 }) } });
    return list.map((e) => ({ ...e, def: { ...(e.group === 'layout' ? { fits: () => true, w: 1, portrait: 1 } : {}), ...e.def, set, tags: [`c-${spec.id}`] } }));
  };
  return {
    id: `visualsync-${spec.id.toLowerCase()}.c`, set, styleKey: `vs-${spec.id.toLowerCase()}.c`, effects: own,
    buildStyle(J) {
      const st = JSON.parse(JSON.stringify(J.STYLES.noir)) as Record<string, unknown> & { name: string };
      st.name = `${spec.name}.c (VisualSync)`; st.desc = spec.desc;
      st.fonts = { display: spec.fonts.display, body: spec.fonts.body, serif: spec.fonts.serif, mono: ['dot'] };
      const s = spec.scheme;
      st.schemes = [{ bg: s.bg, fg: s.fg, sub: s.sub ?? s.fg, accent: s.accent, accent2: s.accent2 ?? s.accent, ink: s.ink ?? s.fg, dim: s.dim ?? '#161616', ghostA: s.accent, ghostB: s.accent2 ?? s.accent }];
      st.texture = { grain: 0, paper: 0, scan: 0 }; st.ghost = 0; st.glow = 0; st.hud = false;
      const bias: Record<string, Record<string, number>> = {};
      for (const e of own(J)) (bias[e.group] ??= {})[e.key] = 10;
      st.bias = bias; st.decor = {};
      return st;
    },
    configure(project, J) {
      const keys = new Set(own(J).map((e) => `${e.group}/${e.key}`));
      const enabled = (project.enabled ?? {}) as Record<string, Record<string, boolean>>;
      for (const group of J.GROUP_KEYS) {
        const values = { ...(enabled[group] ?? {}) };
        for (const key of J.order(group)) if (!keys.has(`${group}/${key}`)) values[key] = false;
        enabled[group] = values;
      }
      project.enabled = enabled;
      project.fx = { ...(project.fx as Record<string, unknown>), glitch: 0, chroma: 0, flash: false, hud: 'off', koma: 0, onTwos: false };
    },
  };
}

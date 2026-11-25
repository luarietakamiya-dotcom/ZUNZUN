import { LyricMotion, type JizuraAudio } from './jizura-adapter';
import { SimpleSubtitle } from './simple-subtitle';
import type { LyricsSettings } from '../types';

/**
 * 歌詞を描くもの: 動く歌詞 (JIZURA の LyricMotion) か、シンプル字幕 (SimpleSubtitle)。
 * どちらも plan.W / plan.H (描く板の大きさ) と render(ctx, t) を持ち、LyricLayer と書き出しは区別せずに使う。
 * 行ごとの指定 (場面のロックなど) は JIZURA にしか無いので、使う所は `instanceof LyricMotion` で確かめる。
 */
export type LyricRenderer = LyricMotion | SimpleSubtitle;

/** 設定の描き方 (lyrics.engine) に合わせて作る */
export function createLyricRenderer(
  lyrics: LyricsSettings,
  audio: JizuraAudio | null,
  opts: Parameters<typeof LyricMotion.create>[2],
): Promise<LyricRenderer> {
  if (lyrics.engine === 'subtitle') return SimpleSubtitle.create(lyrics, { width: opts.width, height: opts.height, audioDuration: audio?.duration });
  return LyricMotion.create(lyrics, audio, opts);
}

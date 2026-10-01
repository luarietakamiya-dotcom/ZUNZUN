import { t2, type Text2 } from '../../core/i18n';
import backgroundImg from '../../assets/help/background.webp';
import exportImg from '../../assets/help/export.webp';
import layersImg from '../../assets/help/layers.webp';
import lyricsInputImg from '../../assets/help/lyrics-input.webp';
import lyricsStepsImg from '../../assets/help/lyrics-steps.webp';
import lyricsTapImg from '../../assets/help/lyrics-tap.webp';
import lyricsTimelineImg from '../../assets/help/lyrics-timeline.webp';
import musicImg from '../../assets/help/music.webp';
import settingsImg from '../../assets/help/settings.webp';
import visualizerImg from '../../assets/help/visualizer.webp';

/**
 * 「使い方」タブ (2026-10-01 ユーザー指示「簡単な使い方と、詳しい使い方をのせたページを書き出しの横に。画像付き」)。
 * 画像は実際の画面を撮ったもの (src/assets/help/。撮り方は docs/HANDOFF.md)。画像の中の文字は日本語のまま。
 * 画面を変えたら、ここの文と画像も合わせて直す。
 */

interface Block {
  title: Text2;
  /** 段落。1 つの Text2 が 1 段落 */
  body: Text2[];
  /** 箇条書き (あれば) */
  list?: Text2[];
  image?: { src: string; alt: Text2 };
}

const QUICK: Block[] = [
  {
    title: { ja: '1. 曲を読み込む', en: '1. Load a song' },
    body: [
      {
        ja: '「音楽」タブで曲のファイル (MP3・WAV など) を選びます。テンポ (BPM) や音の強さを自動で調べます。曲はこのパソコンの中だけで使い、ほかの場所へは送りません。',
        en: 'Pick a song file (MP3, WAV, …) in the Music tab. Tempo (BPM) and loudness are analyzed automatically. The song stays on this computer and is never uploaded.',
      },
    ],
    image: { src: musicImg, alt: { ja: '「音楽」タブで曲を読み込んだところ', en: 'The Music tab with a song loaded' } },
  },
  {
    title: { ja: '2. 歌詞を入れて、タップで合わせる', en: '2. Enter the lyrics and sync by tapping' },
    body: [
      {
        ja: '「歌詞」タブのいちばん上の「はじめかた」に沿って進めます。歌詞を貼りつけたら「1 行目からタップを始める」を押し、曲に合わせて各行の歌い出しで Space キーを叩きます。叩いた時刻が、そのまま歌詞の出る時刻になります。',
        en: 'Follow "Getting started" at the top of the Lyrics tab. Paste the lyrics, press "Start tapping from line 1", and press Space at the start of each line as the song plays. Each tap becomes the time that line appears.',
      },
    ],
    image: { src: lyricsStepsImg, alt: { ja: '「歌詞」タブの「はじめかた」', en: '"Getting started" in the Lyrics tab' } },
  },
  {
    title: { ja: '3. 映像を選ぶ', en: '3. Pick the visuals' },
    body: [
      {
        ja: '「ビジュアライザー」タブで、音に合わせて動く映像の種類を選びます。下のつまみで、派手さや音への反応のしやすさを変えられます。再生すると、その場で動きが見られます。',
        en: 'Choose the music-reactive visuals in the Visualizer tab. The sliders below change how bold they are and how easily they react. Press play to see them move.',
      },
    ],
    image: { src: visualizerImg, alt: { ja: '「ビジュアライザー」タブ (写真に動き)', en: 'The Visualizer tab (Photo Motion)' } },
  },
  {
    title: { ja: '4. 背景を置く (なくても大丈夫)', en: '4. Add a background (optional)' },
    body: [
      {
        ja: '「背景と素材」タブで、写真や動画を背景に敷けます。フォルダを選ぶと、曲に合わせて自動で切り替わるスライドショーになります。',
        en: 'In the Overlay tab you can place a photo or video as the background. Choosing a folder makes a slideshow that switches automatically with the song.',
      },
    ],
    image: { src: backgroundImg, alt: { ja: '「背景と素材」タブの背景の欄', en: 'The background section of the Overlay tab' } },
  },
  {
    title: { ja: '5. 書き出す', en: '5. Export' },
    body: [
      {
        ja: '「書き出し」タブで「書き出しを始める」を押すと、まず保存する場所を聞かれます。選ぶと曲の最初から最後までを動画 (MP4) にして、終わったらそこへ自動で保存します。Chrome か Edge を使ってください。',
        en: 'Press "Start export" in the Export tab. It first asks where to save; then it renders the whole song to a video (MP4) and saves it there automatically when done. Please use Chrome or Edge.',
      },
      {
        ja: '作業の続きは「保存」タブの「プロジェクトを保存」で残せます。',
        en: 'Save your work with "Save project" in the Save tab.',
      },
    ],
    image: { src: exportImg, alt: { ja: '「書き出し」タブ', en: 'The Export tab' } },
  },
];

const DETAILS: Block[] = [
  {
    title: { ja: '音楽', en: 'Music' },
    body: [
      {
        ja: '曲を読み込むと、テンポ・拍・音の強さ・歌声らしさを調べます (長い曲は少しかかります)。画面の上の再生ボタンと時刻のつまみは、どのタブからでも使えます。',
        en: 'Loading a song analyzes its tempo, beats, loudness and voice likelihood (long songs take a moment). The play button and time slider at the top work from any tab.',
      },
    ],
  },
  {
    title: { ja: '歌詞の書き方', en: 'Writing lyrics' },
    body: [
      {
        ja: '歌詞の欄に貼りつけるか、テキスト・LRC・SRT のファイルを読み込みます。LRC・SRT の時刻はそのまま使います。',
        en: 'Paste into the lyrics box or load a text, LRC or SRT file. Times in LRC / SRT are used as-is.',
      },
    ],
    list: [
      { ja: '1 行 = 1 行の歌詞。空行で間を空ける。# で始まる行はコメント', en: 'One line = one lyric line. A blank line adds a pause. Lines starting with # are comments' },
      { ja: '/ で文字のまとまりを区切る、*強調*、行末の ! でキメ、「歌詞|注釈」で注釈', en: '/ splits phrases, *emphasis*, a trailing ! makes a hit, "lyric|note" adds a note' },
      { ja: '[間奏] [間奏 8] (8 秒) で歌詞のない区間', en: '[間奏] / [間奏 8] (8 s) makes an instrumental gap' },
      {
        ja: '[Intro] [Aメロ] [サビ] [Chorus] [Outro] などの見出しは歌詞に出ず、曲の区切りになります (タイムラインに色の帯で出て、背景のスライドショーの切り替えにも使います)',
        en: 'Headings like [Intro] [Verse] [Chorus] [Outro] are not shown; they mark song sections (a colored band on the timeline, also used by the background slideshow)',
      },
    ],
    image: { src: lyricsInputImg, alt: { ja: '見出しを入れた歌詞', en: 'Lyrics with section headings' } },
  },
  {
    title: { ja: 'タップで合わせる', en: 'Syncing by tapping' },
    body: [
      {
        ja: '「1 行目からタップを始める」(または「選んだ行からタップ」) で再生が始まります。大きな歌詞の表示の「次」の行が歌い出したら Space を叩きます。まちがえたら Backspace で 1 つ戻り、Esc で止めます。叩き終えたら「吸着」ボタンで、近くの歌い出しの候補にまとめて寄せることもできます。',
        en: '"Start tapping from line 1" (or "Tap from selected line") starts playback. Press Space when the "next" line in the big display starts. Backspace undoes one, Esc stops. Afterwards the "Snap" button can pull the lines to nearby vocal entries.',
      },
      {
        ja: '「確認する」に切り替えると、記録せずに歌詞と歌が合っているかを見られます。',
        en: 'Switch to "Check" to see whether the lyrics match the singing without recording.',
      },
    ],
    image: { src: lyricsTapImg, alt: { ja: 'タップ中の画面 (歌詞の表示とタイムライン)', en: 'Tapping (lyrics display and timeline)' } },
  },
  {
    title: { ja: 'タイムラインで細かく直す', en: 'Fine-tuning on the timeline' },
    body: [
      {
        ja: '行のブロックの左端で始まり、右端で終わり、真ん中で行ごと動かせます。最初は吸着しないので、置いた所にそのまま置けます。「ドラッグで吸着する」を入れると歌い出しの候補 (緑の目盛り) や拍に合います (Shift を押している間は逆)。← → で選んだ行を 10ms ずつ (Shift で 100ms) 動かせます。Ctrl + ホイールで拡大・縮小します。',
        en: 'Drag a block\'s left edge for the start, right edge for the end, and the middle to move the whole line. Snapping is off at first, so blocks stay where you drop them. Turn on "Snap while dragging" to snap to vocal entries (green ticks) or beats (Shift inverts). ← → nudge the selected line by 10 ms (Shift: 100 ms). Ctrl + wheel zooms.',
      },
      {
        ja: '時刻を変えると「反映」ボタンが出ます。歌詞の動きを作り直すには少し時間がかかるので、合わせ終わってから押してください (書き出しはいつも今の時刻で作ります)。',
        en: 'After changing times an "Apply" button appears. Rebuilding the lyric motion takes a moment, so press it when you are done (export always uses the current times).',
      },
    ],
    image: { src: lyricsTimelineImg, alt: { ja: 'タイムライン (区切りの色の帯と「反映」ボタン)', en: 'The timeline (section band and Apply button)' } },
  },
  {
    title: { ja: 'そのほかの歌詞の機能', en: 'Other lyric features' },
    body: [],
    list: [
      {
        ja: 'ボーカルだけの音: 歌だけを抜き出した音 (stem) を読み込むと、歌い出しの候補がギターやドラムに引っぱられにくくなります',
        en: 'Vocal-only audio: loading a vocal stem keeps vocal-entry detection from being fooled by guitars or drums',
      },
      { ja: 'リズム (変拍子): 5 拍子・7 拍子の曲は、小節の頭を叩いて決められます', en: 'Rhythm (odd meters): for 5/4, 7/8 etc., tap the bar heads' },
      { ja: '歌詞の動き: スタイルと、動きの大きさ・飾りの量・区切りの細かさを選びます。「マイスタイル」で色や書体も変えられます', en: 'Lyric motion: choose a style, motion size, decoration and cut density. "My style" changes colors and fonts' },
    ],
  },
  {
    title: { ja: 'ビジュアライザー (映像の種類と設定)', en: 'Visualizer (visual types and settings)' },
    body: [{ ja: '映像の種類:', en: 'Visual types:' }],
    list: [
      { ja: 'Solar Gate: 光の門と空。低音で光が強まります', en: 'Solar Gate: a gate of light and a sky. The light swells with the bass' },
      { ja: 'Milky Way: 星空と湖。音量で湖に波紋が広がります', en: 'Milky Way: a starry sky and a lake. Ripples spread with the volume' },
      { ja: 'Live Stage: ライブの照明とスモーク。照明の向き・カメラの位置・ステージの機材を選べます', en: 'Live Stage: concert lights and haze. Choose light direction, camera spot and stage gear' },
      { ja: 'Speaker Rack: スピーカーと機材ラックの 3D。コーンが低音で動き、メーターが振れます', en: 'Speaker Rack: 3D speakers and a gear rack. Cones move with the bass, meters swing' },
      { ja: '写真に動き: 写真のスピーカーのコーンや明かりを音で動かします', en: 'Photo Motion: brings the speakers and lights in a photo to life with the music' },
    ],
  },
  {
    title: { ja: '', en: '' },
    body: [
      {
        ja: '「全体の派手さ」「音への反応のしやすさ」「低い音・中くらいの音・高い音への反応」は、どの映像にも共通のつまみです。動きが小さいと感じたら「音への反応のしやすさ」を上げてください。「見え方」で拡大・位置・傾きも変えられます。急に画面全体が光る回数は、光に敏感な人に配慮して抑えています。',
        en: '"Overall boldness", "Sensitivity" and "Low / mid / high response" are shared by all visuals. If the motion feels small, raise "Sensitivity". "View" changes zoom, position and tilt. Large sudden flashes are limited for people sensitive to light.',
      },
    ],
  },
  {
    title: { ja: '背景と素材', en: 'Overlay (background and media)' },
    body: [
      {
        ja: '背景には写真・動画 (MP4・WebM)・用意された背景 3 枚を使えます。暗さ・ぼかし・収め方を変えられます。',
        en: 'Use a photo, a video (MP4 / WebM) or one of the 3 built-in backgrounds. Change dim, blur and fit.',
      },
      {
        ja: 'スライドショー: 「フォルダを選ぶ」か「画像を複数選ぶ」で、ファイル名の順に並べます。歌詞の区切り ([サビ] など) で必ず切り替わり、その間は小節の頭で切り替わります (サビは速く、イントロ・アウトロはゆっくり、枚数が多いほど速く)。ファイル名に「サビ」「Chorus」「Intro」などの言葉がある画像は、その区切りの間だけ出ます。',
        en: 'Slideshow: "Choose a folder" or "Choose several images" lines them up in file-name order. It always switches at lyric sections ([Chorus] etc.) and on bar heads in between (faster in the chorus, slower in the intro / outro, faster with more images). Images whose names contain words like "Chorus", "Intro" or "サビ" appear only in that section.',
      },
      {
        ja: 'レイヤー: 背景・ビジュアライザー・歌詞・重ねる画像の重なる順番と重ね方を変えられます。素材の欄では、グリーンバックの素材を置いて「自動で合わせる」で緑を透かせます。',
        en: 'Layers: change the stacking order and blending of background, visuals, lyrics and overlay images. In Media you can place green-screen footage and key it out with "Auto".',
      },
    ],
    image: { src: layersImg, alt: { ja: 'レイヤー (重なる順番)', en: 'Layers (stacking order)' } },
  },
  {
    title: { ja: 'プロジェクトの保存と読み込み', en: 'Saving and opening projects' },
    body: [
      {
        ja: '「保存」タブの「プロジェクトを保存」で、映像の種類・設定・歌詞と時刻・背景などを 1 つのファイル (.zunzun.json) に残します。曲・画像・動画のファイルそのものは入らないので、開いたあとに同じファイルを選び直してください (同じファイルかどうかは自動で確かめます)。',
        en: '"Save project" in the Save tab keeps the visuals, settings, lyrics and timing, background and more in one file (.zunzun.json). Song, image and video files are not included, so pick the same files again after opening (they are checked automatically).',
      },
    ],
    image: { src: settingsImg, alt: { ja: '「保存」タブ', en: 'The Save tab' } },
  },
  {
    title: { ja: '書き出し', en: 'Export' },
    body: [
      {
        ja: '画面の大きさ (横長・縦長・正方形)・なめらかさ (fps)・画質を選びます。「書き出しを始める」を押すと保存する場所を聞かれ、終わったらそこへ自動で保存します (保存の窓が無いブラウザでは、終わったら自動でダウンロードします)。「もう一度保存する」で別の場所にも残せます。書き出しはこのブラウザの中だけで行い、書き出し中にほかのタブへ移っても続きます。曲の長さや大きさによっては時間がかかります。',
        en: 'Choose size (landscape, portrait, square), frame rate and quality. "Start export" asks where to save and saves there automatically when done (browsers without a save dialog download it automatically). "Save again" keeps another copy. Exporting runs entirely in this browser and continues if you switch tabs. It can take a while for long or large videos.',
      },
    ],
  },
  {
    title: { ja: 'こまったときは', en: 'Troubleshooting' },
    body: [],
    list: [
      { ja: '映像が音に合わせて動かない → 曲を読み込んで再生しているか、「音への反応のしやすさ」を確かめてください', en: 'Visuals do not react → make sure a song is loaded and playing, and check "Sensitivity"' },
      { ja: '写真が二重に見える → 背景と、写真に動きの写真が重なっています。「背景を外す」を押してください', en: 'The photo looks doubled → the background and Photo Motion photo overlap. Press "Remove background"' },
      { ja: '歌詞が映像に出ない → 「歌詞の動き」がオンか、「反映」ボタンが出ていないかを確かめてください', en: 'Lyrics do not show → check that lyric motion is on and whether an "Apply" button is waiting' },
      { ja: '動きが重い → ほかのタブやアプリを閉じるか、書き出しの画面の大きさを下げてください', en: 'It feels slow → close other tabs and apps, or lower the export size' },
    ],
  },
];

function renderBlock(b: Block, level: 'h3' | 'h4'): HTMLElement {
  const sec = document.createElement('section');
  sec.className = 'help-block';
  if (t2(b.title)) {
    const h = document.createElement(level);
    h.className = 'help-title';
    h.textContent = t2(b.title);
    sec.appendChild(h);
  }
  for (const p of b.body) {
    const el = document.createElement('p');
    el.textContent = t2(p);
    sec.appendChild(el);
  }
  if (b.list?.length) {
    const ul = document.createElement('ul');
    for (const item of b.list) {
      const li = document.createElement('li');
      li.textContent = t2(item);
      ul.appendChild(li);
    }
    sec.appendChild(ul);
  }
  if (b.image) {
    const img = document.createElement('img');
    img.className = 'help-image';
    img.src = b.image.src;
    img.alt = t2(b.image.alt);
    img.loading = 'lazy';
    sec.appendChild(img);
  }
  return sec;
}

export function renderHelpPanel(): HTMLElement {
  const root = document.createElement('section');
  root.className = 'panel help-panel';
  const h2 = document.createElement('h2');
  h2.textContent = t2({ ja: '使い方', en: 'How to use' });
  const intro = document.createElement('p');
  intro.textContent = t2({
    ja: 'ZUNZUN は、曲に合わせて動く映像と歌詞の動画を、ブラウザの中だけで作る道具です。曲や画像はほかの場所へ送りません。',
    en: 'ZUNZUN makes music videos with reactive visuals and moving lyrics, entirely inside your browser. Your songs and images are never uploaded.',
  });
  root.append(h2, intro);

  const quick = document.createElement('div');
  quick.className = 'help-card';
  quick.dataset.help = 'quick';
  const qh = document.createElement('h3');
  qh.className = 'help-heading';
  qh.textContent = t2({ ja: 'かんたんな使い方 (5 つの手順)', en: 'Quick start (5 steps)' });
  quick.appendChild(qh);
  for (const b of QUICK) quick.appendChild(renderBlock(b, 'h4'));

  const detail = document.createElement('div');
  detail.className = 'help-card';
  detail.dataset.help = 'details';
  const dh = document.createElement('h3');
  dh.className = 'help-heading';
  dh.textContent = t2({ ja: 'くわしい使い方', en: 'In detail' });
  detail.appendChild(dh);
  // 見出しのない段落は、ひとつ前の項目の続き
  let box: HTMLDetailsElement | null = null;
  for (const b of DETAILS) {
    if (t2(b.title) || !box) {
      box = document.createElement('details');
      box.className = 'help-details';
      const summary = document.createElement('summary');
      summary.textContent = t2(b.title);
      box.appendChild(summary);
      detail.appendChild(box);
      box.appendChild(renderBlock({ ...b, title: { ja: '', en: '' } }, 'h4'));
    } else box.appendChild(renderBlock(b, 'h4'));
  }
  root.append(quick, detail);
  return root;
}

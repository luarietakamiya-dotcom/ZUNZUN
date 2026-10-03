import { store } from '../../core/store';
import { MAX_SLIDES, type BackgroundSettings, type BackgroundSlides } from '../../core/types';
import { sectionKindOf, type SectionKind } from '../../core/lyrics/sections';
import { t2, tr, type Text2 } from '../../core/i18n';
import { findLibraryItem, LIBRARY, libraryRef } from '../../core/library';
import { sliderRow } from './panel-helpers';
import { defaultSlideMotion, type SlideMotionSettings } from '../../core/render/slide-motion';
import { entriesForZone, entriesFromFiles, entriesFromPaths, SLIDE_ZONES, type SlideEntry } from '../../core/render/slide-input';
import { isSlideImage } from '../../core/store';
import { readDropped } from './drop-files';

/**
 * Overlay タブの「背景」欄。一枚絵か動画を選び、収め方・暗さ・ぼかし (画像だけ)・ビジュアライザーの重ね方と濃さ・
 * 動画のくり返しを決める。見た目は Visualizer タブで確かめる (Overlay タブにはライブプレビューが無い)。
 * 動画の音は使わない。プレビューは曲の位置に合わせて流すだけで、書き出しは各フレームの時刻ちょうどの絵を使う。
 * 設定は store (Project JSON の background)、元のファイルは store にメモリだけで持つ (Project JSON には ref/sha256 だけ)。
 */

const ACCEPT = 'image/png,image/webp,image/jpeg,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v';

/** ファイルの種類から、画像か動画かを決める */
function kindOf(file: File): 'image' | 'video' {
  return file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name) ? 'video' : 'image';
}

const SLIDERS: { key: 'dim' | 'blur'; label: Text2; help: Text2 }[] = [
  { key: 'dim', label: { ja: '背景の暗さ', en: 'Background dim' }, help: { ja: '上げるほど背景が暗くなり、ビジュアライザーが見やすくなります', en: 'Darkens the background so the visuals stand out' } },
  { key: 'blur', label: { ja: '背景のぼかし', en: 'Background blur' }, help: { ja: '背景をぼかして、手前を目立たせます', en: 'Blurs the background so the foreground stands out' } },
];

function h<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

/** 区切りの種類の名前 (スライドショーの画像の一覧に出す) */
const KIND_NAME: Record<SectionKind, Text2> = {
  intro: { ja: 'イントロ', en: 'Intro' },
  verse: { ja: 'Aメロ', en: 'Verse' },
  prechorus: { ja: 'Bメロ', en: 'Pre-chorus' },
  chorus: { ja: 'サビ', en: 'Chorus' },
  bridge: { ja: 'Cメロ', en: 'Bridge' },
  interlude: { ja: '間奏', en: 'Interlude' },
  outro: { ja: 'アウトロ', en: 'Outro' },
  other: { ja: 'その他', en: 'Other' },
};

/** スライドショーの画像のサムネイルの URL (ファイルごとに 1 つ) */
const slideThumbs = new WeakMap<File, string>();
function slideThumbUrl(file: File): string {
  let url = slideThumbs.get(file);
  if (!url) {
    url = URL.createObjectURL(file);
    slideThumbs.set(file, url);
  }
  return url;
}

/** サムネイル用の URL (ファイルごとに 1 つ。タブを切り替えても作り直さない) */
let thumb: { file: File; url: string } | null = null;
function thumbUrl(file: File): string {
  if (thumb?.file !== file) {
    if (thumb) URL.revokeObjectURL(thumb.url);
    thumb = { file, url: URL.createObjectURL(file) };
  }
  return thumb.url;
}

export function createBackgroundCard(): HTMLElement {
  const root = h('div', 'background-card');
  root.dataset.background = 'card';
  root.append(
    h('h3', 'lyrics-h3', tr('背景 (写真・動画)', 'Background (photo / video)')),
    h(
      'p',
      'lyrics-help',
      tr(
        '写真か動画 (MP4 (H.264) / WebM) を背景に敷きます。重なる順番とビジュアライザーの重ね方は、上の「レイヤー」で変えられます (スクリーンなら、ビジュアライザーの黒い部分は透けて光だけが乗ります)。背景には光のにじみはかかりません。動画の音は使いません。動画は曲と同じ時刻から流れ、曲より短ければくり返すか最後の絵で止めます。見た目は右 (狭い画面では上) のプレビューで確かめられます。',
        'Place a photo or video (MP4 (H.264) / WebM) as the background. Change the stacking order and how the visuals are layered in "Layers" above (with Screen, the visuals\' black is see-through and only light is added). The background gets no glow. Video sound is not used. The video plays from the same time as the song; if shorter it loops or holds the last frame. Check the result in the preview on the right (top on narrow screens).',
      ),
    ),
  );
  const fileRow = h('div', 'row-gap lyrics-row-wrap');
  const input = h('input');
  input.type = 'file';
  input.accept = ACCEPT;
  const removeBtn = h('button', 'tab-button', tr('背景を外す', 'Remove background'));
  removeBtn.type = 'button';
  fileRow.append(h('span', 'param-label', tr('写真・動画を選ぶ:', 'Choose a photo / video:')), input, removeBtn);
  // スライドショー: フォルダか、複数の画像を選ぶ (曲に合わせて自動で切り替える)
  const slideRow = h('div', 'row-gap lyrics-row-wrap');
  const folderInput = h('input');
  folderInput.type = 'file';
  folderInput.multiple = true;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.dataset.background = 'slides-folder';
  const filesInput = h('input');
  filesInput.type = 'file';
  filesInput.multiple = true;
  filesInput.accept = 'image/*';
  filesInput.dataset.background = 'slides-files';
  const folderBtn = h('button', 'tab-button', tr('フォルダを選ぶ', 'Choose a folder'));
  folderBtn.type = 'button';
  folderBtn.addEventListener('click', () => folderInput.click());
  const filesBtn = h('button', 'tab-button', tr('画像を複数選ぶ', 'Choose several images'));
  filesBtn.type = 'button';
  filesBtn.addEventListener('click', () => filesInput.click());
  folderInput.hidden = true;
  filesInput.hidden = true;
  slideRow.append(h('span', 'param-label', tr('スライドショー (曲に合わせて自動で切り替え):', 'Slideshow (switches automatically with the song):')), folderBtn, filesBtn, folderInput, filesInput);
  // 用意された背景 (core/library.ts)。押すとすぐ背景になる
  const libRow = h('div', 'library-row');
  const libButtons: HTMLButtonElement[] = [];
  for (const item of LIBRARY) {
    const b = h('button', 'library-thumb');
    b.type = 'button';
    b.dataset.library = item.id;
    const img = h('img');
    img.src = item.url;
    img.alt = t2(item.name);
    img.loading = 'lazy';
    b.append(img, h('span', '', t2(item.name)));
    b.addEventListener('click', () => {
      status.textContent = tr(`「${t2(item.name)}」を読み込んでいます…`, `Loading "${t2(item.name)}"…`);
      store
        .setBackgroundFromLibrary(item.id)
        .then(() => render())
        .catch((err: unknown) => {
          status.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
        });
    });
    libButtons.push(b);
    libRow.appendChild(b);
  }
  const status = h('div', 'param-label');
  const body = h('div', 'background-body');

  // 区切りごとの入れ場所 (ドラッグ&ドロップ、または押して選ぶ)。入れた画像は、ファイル名に関係なくその区切りで使う
  const zonesBox = h('div', 'slide-zones');
  zonesBox.dataset.background = 'slide-zones';
  const zoneCounts = new Map<SectionKind, HTMLElement>();
  const slideNote = (r: { skipped: number }): string => (r.skipped > 0 ? tr(`${r.skipped} 個のファイルは使いませんでした (画像でない・大きすぎる・${MAX_SLIDES} 枚を超えた)。`, `Skipped ${r.skipped} files (not images, too large, or over ${MAX_SLIDES}).`) : '');
  /** 画像を入れたあとの表示 (読み込み中の表示 → 結果。失敗したら理由) */
  const runSlides = (job: Promise<string>, loading: string): void => {
    status.textContent = loading;
    job
      .then((note) => {
        render();
        if (note) status.textContent = `${status.textContent} ${note}`;
      })
      .catch((err: unknown) => {
        status.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
      });
  };
  const addToZone = (kind: SectionKind, files: readonly File[]): void => {
    const images = files.filter(isSlideImage);
    if (images.length === 0) {
      status.textContent = tr('画像が見つかりませんでした (PNG / JPEG / WebP など)', 'No images found (PNG / JPEG / WebP etc.)');
      return;
    }
    runSlides(
      store.setBackgroundSlides(entriesForZone(images, kind), { add: true }).then(slideNote),
      tr(`${t2(KIND_NAME[kind])}に ${images.length} 枚を入れています…`, `Adding ${images.length} image(s) to ${t2(KIND_NAME[kind])}…`),
    );
  };
  for (const kind of SLIDE_ZONES) {
    const zone = h('div', 'slide-zone');
    zone.dataset.zone = kind;
    const pick = h('input');
    pick.type = 'file';
    pick.multiple = true;
    pick.accept = 'image/*';
    pick.hidden = true;
    pick.dataset.zoneInput = kind;
    const btn = h('button', 'tab-button slide-zone-button', t2(KIND_NAME[kind]));
    btn.type = 'button';
    btn.addEventListener('click', () => pick.click());
    const count = h('span', 'slide-zone-count');
    zoneCounts.set(kind, count);
    zone.append(btn, count, pick);
    pick.addEventListener('change', () => {
      const files = [...(pick.files ?? [])];
      pick.value = '';
      if (files.length) addToZone(kind, files);
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('is-dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('is-dragover');
      void readDropped(e.dataTransfer).then((dropped) => addToZone(kind, dropped.map((d) => d.file)));
    });
    zonesBox.appendChild(zone);
  }
  /** 入れ場所ごとの枚数 (指定した画像と、ファイル名の言葉で決まる画像) */
  const updateZones = (): void => {
    const items = store.background?.slides?.items ?? [];
    for (const kind of SLIDE_ZONES) {
      const n = items.filter((it) => (it.kind ?? sectionKindOf(it.ref)) === kind).length;
      zoneCounts.get(kind)!.textContent = n > 0 ? tr(`${n} 枚`, `${n}`) : '–';
    }
  };

  root.append(
    fileRow,
    slideRow,
    h('span', 'param-label', tr('区切りごとの入れ場所 (画像をドラッグ&ドロップ、または押して選ぶ。ファイル名に関係なく、その区切りで使います):', 'Spots for each song section (drop images here, or press to choose; they are used in that section whatever their file names):')),
    zonesBox,
    h(
      'p',
      'lyrics-help',
      tr(
        `このカードのどこへでも、画像・フォルダ・動画をドラッグ&ドロップできます (上の入れ場所へ落とすと、その区切りに入ります)。フォルダの中に「イントロ」「サビ」などの名前のフォルダがあれば、その中の画像はその区切りで使います。画像は ${MAX_SLIDES} 枚まで、足していけます (すでにあるスライドショーに足されます。1 枚だけ落とすと、今までどおり 1 枚の背景です)。歌詞の [サビ] などの区切りで必ず切り替わり、その間は小節の頭で切り替わります (サビは速く、イントロ・アウトロはゆっくり。枚数が多いほど速く)。区切りを決めていない画像は、ファイル名に「サビ」「Chorus」「Intro」などの言葉があればその区切りの間だけ、なければ専用の画像が無い区切りで出ます。`,
        `You can drop images, folders or a video anywhere on this card (dropping on a spot above puts them in that section). If the folder contains sub-folders named like "Intro" or "Chorus", their images are used in that section. Add up to ${MAX_SLIDES} images (they are added to the current slideshow; dropping just one image sets a single background as before). It always switches at song sections like [Chorus] in the lyrics, and on bar heads in between (faster in the chorus, slower in the intro / outro, faster with more images). An image with no section set appears only in the section named by a word in its file name ("Chorus", "Intro", "サビ"…), or otherwise in sections that have no images of their own.`,
      ),
    ),
    h('span', 'param-label', tr('用意された背景から選ぶ:', 'Or pick a built-in background:')),
    libRow,
    status,
    body,
  );
  const onSlides = (picked: HTMLInputElement): void => {
    const files = [...(picked.files ?? [])];
    picked.value = '';
    if (files.length === 0) return;
    status.textContent = tr(`${files.length} 個のファイルを読み込んでいます…`, `Loading ${files.length} files…`);
    // プロジェクトを開いたあと (画像を選び直していない) なら、同じ画像を探して当てる。そうでなければ新しいスライドショー
    const bg = store.background;
    const restoring = bg?.slides != null && store.slideFiles.some((f) => f == null);
    const job = restoring
      ? store.restoreSlides(files).then((r) => tr(`${r.total} 枚のうち ${r.matched} 枚が見つかりました。`, `Found ${r.matched} of ${r.total} images.`))
      : store.setBackgroundSlides(entriesFromFiles(files)).then((r) => (r.skipped > 0 ? tr(`${r.skipped} 個のファイルは使いませんでした (画像でない・大きすぎる・${MAX_SLIDES} 枚を超えた)。`, `Skipped ${r.skipped} files (not images, too large, or over ${MAX_SLIDES}).`) : ''));
    job
      .then((note) => {
        render();
        if (note) status.textContent = `${status.textContent} ${note}`;
      })
      .catch((err: unknown) => {
        status.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
      });
  };
  folderInput.addEventListener('change', () => onSlides(folderInput));
  filesInput.addEventListener('change', () => onSlides(filesInput));

  // カードのどこへ落としても入る (フォルダ・動画も)。区切りは、フォルダ名で決める
  const onCardDrop = async (dropped: { file: File; dirs: string[] }[]): Promise<string> => {
    const images = dropped.filter((d) => isSlideImage(d.file));
    if (images.length === 0) {
      const video = dropped.find((d) => kindOf(d.file) === 'video');
      if (!video) throw new Error(tr('画像か動画が見つかりませんでした', 'No image or video found'));
      await store.setBackgroundFile(video.file, 'video');
      return '';
    }
    const entries: SlideEntry[] = entriesFromPaths(images);
    // プロジェクトを開いたあと (画像を選び直していない) なら、同じ画像を探して当てる
    if (store.background?.slides != null && store.slideFiles.some((f) => f == null) && entries.every((e) => !e.kind)) {
      const r = await store.restoreSlides(entries.map((e) => e.file));
      return tr(`${r.total} 枚のうち ${r.matched} 枚が見つかりました。`, `Found ${r.matched} of ${r.total} images.`);
    }
    // 区切りの指定が無い 1 枚だけで、スライドショーでなければ、今までどおり 1 枚の背景 (置き換え)
    if (entries.length === 1 && !entries[0]!.kind && !store.background?.slides) {
      await store.setBackgroundFile(entries[0]!.file, 'image');
      return '';
    }
    return slideNote(await store.setBackgroundSlides(entries, { add: true }));
  };
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    root.classList.add('is-dragover');
  });
  root.addEventListener('dragleave', (e) => {
    if (!root.contains(e.relatedTarget as Node | null)) root.classList.remove('is-dragover');
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    root.classList.remove('is-dragover');
    const read = readDropped(e.dataTransfer);
    runSlides(read.then(onCardDrop), tr('読み込んでいます…', 'Loading…'));
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    status.textContent = tr(`「${file.name}」を読み込んでいます…`, `Loading "${file.name}"…`);
    store
      .setBackgroundFile(file, kindOf(file))
      .then(() => render())
      .catch((err: unknown) => {
        status.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
      })
      .finally(() => {
        input.value = '';
      });
  });
  removeBtn.addEventListener('click', () => {
    store.removeBackground();
    render();
  });

  function render(): void {
    const bg = store.background;
    const file = store.backgroundFile;
    updateZones();
    body.textContent = '';
    removeBtn.disabled = bg == null;
    const lib = bg ? findLibraryItem(bg.ref, bg.sha256) : null;
    for (const b of libButtons) b.setAttribute('aria-pressed', String(lib != null && bg?.ref === libraryRef(lib) && b.dataset.library === lib.id));
    if (!bg) {
      status.textContent = tr('背景はありません。', 'No background.');
      return;
    }
    if (bg.slides) {
      renderSlides(bg, bg.slides);
      return;
    }
    if (lib && !file) {
      // プロジェクトを開いた直後: 用意された背景は自動で読み込む
      status.textContent = tr(`「${t2(lib.name)}」を読み込んでいます…`, `Loading "${t2(lib.name)}"…`);
      store
        .restoreLibraryBackground()
        .then(() => {
          if (root.isConnected && store.backgroundFile) render();
        })
        .catch((err: unknown) => {
          status.textContent = `${tr('読み込めませんでした', 'Could not load')}: ${err instanceof Error ? err.message : String(err)}`;
        });
      return;
    }
    const shownName = lib ? t2(lib.name) : bg.ref;
    status.textContent = file
      ? tr(`「${shownName}」`, `"${shownName}"`)
      : tr(`このプロジェクトは背景に「${bg.ref}」を使います。同じファイルを選び直してください (選び直すまでは背景なしで描きます)。`, `This project uses "${bg.ref}" as its background. Please pick the same file again (until then no background is drawn).`);
    if (file) {
      if (bg.kind === 'video') {
        const v = h('video', 'background-thumb');
        v.src = thumbUrl(file);
        v.muted = true;
        v.controls = true;
        v.preload = 'metadata';
        body.appendChild(v);
      } else {
        const img = h('img', 'background-thumb');
        img.src = thumbUrl(file);
        img.alt = bg.ref;
        body.appendChild(img);
      }
    }
    const grid = h('div', 'param-grid');
    // 収め方・重ね方
    const fit = h('select', 'select');
    for (const [v, label] of [['cover', tr('画面いっぱい (はみ出した部分は切る)', 'Fill the screen (crop the overflow)')], ['contain', tr('全体を収める (余りは黒)', 'Fit inside (black bars)')]] as const) {
      const o = h('option', '', label);
      o.value = v;
      fit.appendChild(o);
    }
    fit.value = bg.fit;
    fit.addEventListener('change', () => store.updateBackground({ fit: fit.value as BackgroundSettings['fit'] }));
    const selRow = (label: string, el: HTMLElement): HTMLElement => {
      const r = h('label', 'param-row');
      r.append(h('span', 'param-label', label), el);
      return r;
    };
    grid.append(selRow(tr('収め方', 'Fit'), fit));
    if (bg.kind === 'video') {
      const loop = h('input');
      loop.type = 'checkbox';
      loop.checked = bg.loop;
      loop.addEventListener('change', () => store.updateBackground({ loop: loop.checked }));
      const r = h('label', 'row-gap param-label');
      r.append(loop, tr('曲より短いときはくり返す (オフなら最後の絵で止める)', 'Loop when shorter than the song (off = hold the last frame)'));
      grid.appendChild(r);
    }
    // ぼかしは画像だけ (動画を毎フレームぼかすのは重いので、今は付けていない)
    for (const def of SLIDERS.filter((d) => d.key !== 'blur' || bg.kind === 'image')) {
      const { row: r, input: range, setLabel } = sliderRow(def.label, def.help, 0, 1, 0.01);
      range.value = String(bg[def.key]);
      setLabel(bg[def.key].toFixed(2));
      range.addEventListener('input', () => {
        const v = parseFloat(range.value);
        store.updateBackground({ [def.key]: v });
        setLabel(v.toFixed(2));
      });
      grid.appendChild(r);
    }
    body.appendChild(grid);
  }

  /** スライドショーのときの欄: 画像の一覧 (区切りの言葉があれば印) と、切り替えの設定 */
  function renderSlides(bg: BackgroundSettings, slides: BackgroundSlides): void {
    const files = store.slideFiles;
    const missing = slides.items.filter((_, i) => !files[i]).length;
    status.textContent =
      missing === 0
        ? tr(`スライドショー: ${slides.items.length} 枚`, `Slideshow: ${slides.items.length} images`)
        : tr(
            `スライドショー: ${slides.items.length} 枚のうち ${missing} 枚をまだ選び直していません。同じフォルダを「フォルダを選ぶ」で選び直してください (選び直すまでは、見つかった画像だけで切り替えます)。`,
            `Slideshow: ${missing} of ${slides.items.length} images have not been picked again. Choose the same folder with "Choose a folder" (until then only the found images are used).`,
          );
    const list = h('div', 'slide-list');
    list.dataset.background = 'slide-list';
    slides.items.forEach((it, i) => {
      const cell = h('div', 'slide-item');
      const f = files[i];
      if (f) {
        const img = h('img');
        img.src = slideThumbUrl(f);
        img.alt = it.ref;
        img.loading = 'lazy';
        cell.appendChild(img);
      } else cell.appendChild(h('div', 'slide-missing', tr('未選択', 'Not picked')));
      cell.append(h('span', 'slide-name', it.ref));
      // 使う区切り: 決めていなければ、ファイル名の言葉で決まる (言葉も無ければ、専用の画像が無い区切りで出る)
      const word = sectionKindOf(it.ref);
      const sel = h('select', 'select slide-kind-select');
      sel.dataset.slideKind = String(i);
      sel.setAttribute('aria-label', tr(`${it.ref} を使う区切り`, `Section for ${it.ref}`));
      const auto = h('option', '', word && word !== 'other' ? tr(`自動: ${t2(KIND_NAME[word])}`, `Auto: ${t2(KIND_NAME[word])}`) : tr('指定なし', 'Not set'));
      auto.value = '';
      sel.appendChild(auto);
      for (const k of SLIDE_ZONES) {
        const o = h('option', '', t2(KIND_NAME[k]));
        o.value = k;
        sel.appendChild(o);
      }
      sel.value = it.kind ?? '';
      sel.addEventListener('change', () => {
        store.setSlideKind(i, (sel.value || null) as SectionKind | null);
        render();
      });
      const del = h('button', 'tab-button slide-remove', '×');
      del.type = 'button';
      del.dataset.slideRemove = String(i);
      del.title = tr('このスライドショーから外す', 'Remove from the slideshow');
      del.setAttribute('aria-label', tr(`${it.ref} を外す`, `Remove ${it.ref}`));
      del.addEventListener('click', () => {
        store.removeSlide(i);
        render();
      });
      cell.append(h('div', 'slide-controls'));
      cell.lastElementChild!.append(sel, del);
      list.appendChild(cell);
    });
    body.appendChild(list);

    const grid = h('div', 'param-grid');
    const fit = h('select', 'select');
    for (const [v, label] of [['cover', tr('画面いっぱい (はみ出した部分は切る)', 'Fill the screen (crop the overflow)')], ['contain', tr('全体を収める (余りは黒)', 'Fit inside (black bars)')]] as const) {
      const o = h('option', '', label);
      o.value = v;
      fit.appendChild(o);
    }
    fit.value = bg.fit;
    fit.addEventListener('change', () => store.updateBackground({ fit: fit.value as BackgroundSettings['fit'] }));
    const trans = h('select', 'select');
    trans.dataset.background = 'slides-transition';
    for (const [v, label] of [['fade', tr('じわっと重なる', 'Crossfade')], ['cut', tr('パッと切り替え', 'Cut')]] as const) {
      const o = h('option', '', label);
      o.value = v;
      trans.appendChild(o);
    }
    trans.value = slides.transition;
    const selRow = (label: string, el: HTMLElement): HTMLElement => {
      const r = h('label', 'param-row');
      r.append(h('span', 'param-label', label), el);
      return r;
    };
    grid.append(selRow(tr('収め方', 'Fit'), fit), selRow(tr('切り替わり方', 'Transition'), trans));
    const fadeRow = sliderRow({ ja: '重なる長さ', en: 'Crossfade length' }, { ja: 'じわっと重なるときの長さ (秒)', en: 'How long the crossfade takes (seconds)' }, 0.1, 3, 0.05);
    fadeRow.input.value = String(slides.fadeSec);
    fadeRow.setLabel(`${slides.fadeSec.toFixed(2)}${tr('秒', 's')}`);
    fadeRow.input.addEventListener('input', () => {
      const v = parseFloat(fadeRow.input.value);
      store.updateBackgroundSlides({ fadeSec: v });
      fadeRow.setLabel(`${v.toFixed(2)}${tr('秒', 's')}`);
    });
    fadeRow.row.hidden = slides.transition !== 'fade';
    trans.addEventListener('change', () => {
      store.updateBackgroundSlides({ transition: trans.value as BackgroundSlides['transition'] });
      fadeRow.row.hidden = trans.value !== 'fade';
    });
    const paceRow = sliderRow(
      { ja: '切り替えの細かさ', en: 'Switch rate' },
      { ja: '上げるほど速く (短い間隔で) 切り替わります。0.50 が既定', en: 'Higher switches more often. 0.50 is the default' },
      0,
      1,
      0.01,
    );
    paceRow.input.dataset.background = 'slides-pace';
    paceRow.input.value = String(slides.pace);
    paceRow.setLabel(slides.pace.toFixed(2));
    paceRow.input.addEventListener('input', () => {
      const v = parseFloat(paceRow.input.value);
      store.updateBackgroundSlides({ pace: v });
      paceRow.setLabel(v.toFixed(2));
    });
    grid.append(fadeRow.row, paceRow.row);

    // 画像の動き (ケン・バーンズ効果。core/render/slide-motion.ts)。前のプロジェクトで設定が無いときは「動かさない」
    const motion: SlideMotionSettings = slides.motion ?? { ...defaultSlideMotion(), enabled: false };
    const setMotion = (patch: Partial<SlideMotionSettings>): void => {
      Object.assign(motion, patch);
      store.updateBackgroundSlides({ motion: { ...motion } });
    };
    const check = (label: string, help: string, key: 'enabled' | 'bySection', data: string): { row: HTMLElement; input: HTMLInputElement } => {
      const r = h('label', 'param-row');
      const line = h('span', 'row-gap');
      const input = h('input');
      input.type = 'checkbox';
      input.checked = motion[key];
      input.dataset.background = data;
      line.append(input, h('span', 'param-label', label));
      r.append(line, h('span', 'param-help', help));
      return { row: r, input };
    };
    const onOff = check(tr('画像をゆっくり動かす', 'Slowly move the images'), tr('少し拡大して、寄る・引く・横や斜めに流れる、をゆっくり繰り返します', 'Zooms in a little and slowly pushes in, pulls out or drifts sideways'), 'enabled', 'slides-motion');
    const amountRow = sliderRow({ ja: '動きの大きさ', en: 'Motion amount' }, { ja: '上げるほど大きく拡大して、大きく動きます (画像の端が少し切れます)', en: 'Higher zooms and moves more (crops a little more of the edges)' }, 0, 1, 0.01);
    amountRow.input.dataset.background = 'slides-motion-amount';
    amountRow.input.value = String(motion.amount);
    amountRow.setLabel(motion.amount.toFixed(2));
    amountRow.input.addEventListener('input', () => {
      const v = parseFloat(amountRow.input.value);
      setMotion({ amount: v });
      amountRow.setLabel(v.toFixed(2));
    });
    const bySection = check(tr('区切りで強さを変える', 'Vary by section'), tr('サビは大きく、イントロ・アウトロはゆっくり動きます (歌詞の [サビ] などの見出しを使います)', 'Bigger in the chorus, gentler in the intro and outro (uses headings like [Chorus] in the lyrics)'), 'bySection', 'slides-motion-section');
    const beatRow = sliderRow({ ja: '拍で寄る', en: 'Beat push' }, { ja: '拍の直後にほんの少し寄って、すぐ戻ります (0 で寄らない)', en: 'Pushes in very slightly right after each beat (0 = off)' }, 0, 1, 0.01);
    beatRow.input.dataset.background = 'slides-motion-beat';
    beatRow.input.value = String(motion.beatPush);
    beatRow.setLabel(motion.beatPush.toFixed(2));
    beatRow.input.addEventListener('input', () => {
      const v = parseFloat(beatRow.input.value);
      setMotion({ beatPush: v });
      beatRow.setLabel(v.toFixed(2));
    });
    const detail = [amountRow.row, bySection.row, beatRow.row];
    const showDetail = (): void => {
      for (const r of detail) r.hidden = !motion.enabled;
    };
    onOff.input.addEventListener('change', () => {
      setMotion({ enabled: onOff.input.checked });
      showDetail();
    });
    bySection.input.addEventListener('change', () => setMotion({ bySection: bySection.input.checked }));
    showDetail();
    grid.append(onOff.row, ...detail);
    for (const def of SLIDERS) {
      const { row: r, input: range, setLabel } = sliderRow(def.label, def.help, 0, 1, 0.01);
      range.value = String(bg[def.key]);
      setLabel(bg[def.key].toFixed(2));
      range.addEventListener('input', () => {
        const v = parseFloat(range.value);
        store.updateBackground({ [def.key]: v });
        setLabel(v.toFixed(2));
      });
      grid.appendChild(r);
    }
    body.appendChild(grid);
  }

  render();
  return root;
}

import { store } from '../../core/store';
import { tr } from '../../core/i18n';
import { buildProjectFile, ProjectParseError, readProjectFile, saveProjectToFile, sanitizeProject } from '../../core/project';

/** ファイル名として使える形に整える (拡張子除去 + Project ファイル名に使えない文字を落とす程度の簡易版)。 */
function suggestedProjectName(): string {
  if (!store.audio.isLoaded) return 'project';
  return store.audio.fileName.replace(/\.[^./\\]+$/, '') || 'project';
}

export function renderSettingsPanel(): HTMLElement {
  const el = document.createElement('section');
  el.className = 'panel';

  const h2 = document.createElement('h2');
  h2.textContent = tr('設定', 'Settings');
  el.appendChild(h2);

  const p = document.createElement('p');
  p.textContent =
    tr(
      '作業の内容 (映像の種類・設定・歌詞・背景など) を「プロジェクト」(.zunzun.json) として保存・読み込みします。曲・画像・動画のファイルそのものは入らないので、開いたあとに同じファイルを選び直してください。',
      'Save and open your work (visual preset, settings, lyrics, background, ...) as a project (.zunzun.json). Song, image and video files are not included, so pick the same files again after opening.',
    );
  el.appendChild(p);

  const status = document.createElement('div');
  status.className = 'placeholder-card';
  el.appendChild(status);

  const controls = document.createElement('div');
  controls.className = 'row-gap';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'tab-button';
  saveBtn.textContent = tr('プロジェクトを保存', 'Save project');

  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.className = 'tab-button';
  loadBtn.textContent = tr('プロジェクトを開く', 'Open project');

  const loadInput = document.createElement('input');
  loadInput.type = 'file';
  loadInput.accept = '.json,application/json';
  loadInput.style.display = 'none';

  controls.appendChild(saveBtn);
  controls.appendChild(loadBtn);
  el.appendChild(controls);
  el.appendChild(loadInput);

  const refreshStatus = (): void => {
    const audioText = store.audio.isLoaded ? `${tr('曲', 'Song')}: ${store.audio.fileName}` : tr('曲: まだ読み込んでいません', 'Song: not loaded');
    status.textContent = `${tr('乱数の種 (seed)', 'Seed')}: ${store.seed} / ${tr('映像', 'Preset')}: ${store.presetId ?? tr('(未選択)', '(none)')} / ${audioText}`;
  };
  refreshStatus();

  saveBtn.addEventListener('click', () => {
    const project = buildProjectFile(store);
    saveProjectToFile(project, suggestedProjectName()).catch((err: unknown) => {
      status.textContent = `${tr('保存できませんでした', 'Could not save')}: ${err instanceof Error ? err.message : String(err)}`;
    });
  });

  loadBtn.addEventListener('click', () => loadInput.click());

  loadInput.addEventListener('change', () => {
    const file = loadInput.files?.[0];
    loadInput.value = ''; // 同じファイルを連続で選んでも change が発火するようにする
    if (!file) return;

    readProjectFile(file)
      .then((raw) => {
        const project = sanitizeProject(raw);
        store.applyProject(project);
        refreshStatus();
        if (project.audio) {
          status.textContent += tr(` — 「${project.audio.name}」を「音楽」タブから読み込み直してください`, ` — please load "${project.audio.name}" again in the Music tab`);
        }
      })
      .catch((err: unknown) => {
        status.textContent =
          err instanceof ProjectParseError
            ? `${tr('開けませんでした', 'Could not open')}: ${err.message}`
            : `${tr('開けませんでした', 'Could not open')}: ${err instanceof Error ? err.message : String(err)}`;
      });
  });

  return el;
}

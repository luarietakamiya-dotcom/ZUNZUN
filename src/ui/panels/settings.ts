import { store } from '../../core/store';
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
  h2.textContent = 'Settings';
  el.appendChild(h2);

  const p = document.createElement('p');
  p.textContent =
    'プロジェクト (seed・選択中のプリセット・パラメータ) を .zunzun.json として保存/読み込みします。' +
    '音源本体はファイルサイズの都合上プロジェクトに含めないため、読み込み後は Music タブから同じ音源を選び直してください。';
  el.appendChild(p);

  const status = document.createElement('div');
  status.className = 'placeholder-card';
  el.appendChild(status);

  const controls = document.createElement('div');
  controls.className = 'row-gap';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'tab-button';
  saveBtn.textContent = 'プロジェクトを保存';

  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.className = 'tab-button';
  loadBtn.textContent = 'プロジェクトを開く';

  const loadInput = document.createElement('input');
  loadInput.type = 'file';
  loadInput.accept = '.json,application/json';
  loadInput.style.display = 'none';

  controls.appendChild(saveBtn);
  controls.appendChild(loadBtn);
  el.appendChild(controls);
  el.appendChild(loadInput);

  const refreshStatus = (): void => {
    const audioText = store.audio.isLoaded ? `音源: ${store.audio.fileName}` : '音源: 未読み込み';
    status.textContent = `seed: ${store.seed} / preset: ${store.presetId ?? '(未選択)'} / ${audioText}`;
  };
  refreshStatus();

  saveBtn.addEventListener('click', () => {
    const project = buildProjectFile(store);
    saveProjectToFile(project, suggestedProjectName()).catch((err: unknown) => {
      status.textContent = `保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`;
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
          status.textContent += ` — 「${project.audio.name}」を Music タブから読み込み直してください`;
        }
      })
      .catch((err: unknown) => {
        status.textContent =
          err instanceof ProjectParseError
            ? `読み込めませんでした: ${err.message}`
            : `読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`;
      });
  });

  return el;
}

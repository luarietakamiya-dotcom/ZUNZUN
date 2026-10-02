import { layoutMode, onLayoutChange } from './ui/layout';
import { mobileActive, mountMobileShell, selectMobilePanel } from './ui/mobile-shell';
import { mountShell, pcActive, selectPcPanel } from './ui/shell';

const root = document.getElementById('app');
if (!root) throw new Error('#app root element not found');
const app: HTMLElement = root;

// PC 表示とスマホ表示 (ui/layout.ts)。切り替えたら枠組みを作り直し、同じパネルを開く
let mode = layoutMode();
let dispose = mode === 'mobile' ? mountMobileShell(app) : mountShell(app);
onLayoutChange(() => {
  const next = layoutMode();
  if (next === mode) return;
  dispose();
  if (next === 'mobile') selectMobilePanel(pcActive());
  else selectPcPanel(mobileActive().panel);
  mode = next;
  dispose = next === 'mobile' ? mountMobileShell(app) : mountShell(app);
});

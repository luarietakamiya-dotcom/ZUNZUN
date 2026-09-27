import { mountShell } from './ui/shell';

const root = document.getElementById('app');
if (!root) throw new Error('#app root element not found');
mountShell(root);

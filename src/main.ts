import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { Pane, type SpawnSettings } from './pane';
import { LAYOUTS, layoutById, layoutFor, layoutIcon, type Layout } from './layouts';
import type { Status } from './status';

interface Settings extends SpawnSettings {
  continueOnRestore: boolean;
  notifications: boolean;
  fontSize: number;
}

interface SavedState {
  layout: string;
  panes: { name: string; cwd: string }[];
  recent: string[];
  settings: Settings;
}

const DEFAULTS: Settings = {
  shell: 'powershell',
  autoClaude: true,
  claudeArgs: '',
  continueOnRestore: true,
  notifications: true,
  fontSize: 13,
};

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const gridEl = $<HTMLElement>('#grid');
const layoutsEl = $<HTMLElement>('#layouts');
const summaryEl = $<HTMLElement>('#summary');
const newMenu = $<HTMLElement>('#new-menu');
const settingsMenu = $<HTMLElement>('#settings-menu');

let layout: Layout = LAYOUTS[4];
let panes: Pane[] = [];
let focused: Pane | null = null;
let maximized: Pane | null = null;
let recent: string[] = [];
let settings: Settings = { ...DEFAULTS };
let home = '';

const byId = new Map<string, Pane>();
// DevTools'ta (F12) hata ayıklama için.
Object.defineProperty(window, '__sa', { get: () => ({ panes, layout, settings }) });
window.api.pty.onData((id, data) => byId.get(id)?.write(data));
window.api.pty.onExit((id, code) => byId.get(id)?.exited(code));

// ---------- kalıcılık ----------
let saveTimer = 0;
function save(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const s: SavedState = {
      layout: layout.id,
      panes: panes.map((p) => ({ name: p.name, cwd: p.cwd })),
      recent,
      settings,
    };
    window.api.saveState(s);
  }, 300);
}

// ---------- grid ----------
function render(): void {
  gridEl.style.gridTemplateColumns = `repeat(${layout.cols}, minmax(0, 1fr))`;
  gridEl.style.gridTemplateRows = `repeat(${layout.rows}, minmax(0, 1fr))`;
  gridEl.classList.toggle('has-max', !!maximized);
  gridEl.querySelectorAll('.empty').forEach((e) => e.remove());

  panes.forEach((p, i) => {
    p.setIndex(i);
    p.el.style.gridArea = layout.cells[i] ?? 'auto';
    p.el.classList.toggle('focused', p === focused);
    p.el.classList.toggle('max', p === maximized);
    if (p.el.parentElement !== gridEl) gridEl.appendChild(p.el);
  });

  for (let i = panes.length; i < layout.cells.length; i++) {
    const cell = document.createElement('button');
    cell.className = 'empty';
    cell.style.gridArea = layout.cells[i];
    cell.innerHTML = `<span class="plus">+</span><span>Yeni terminal</span><kbd>Ctrl+Shift+T</kbd>`;
    cell.addEventListener('click', (e) => openNewMenu(e.currentTarget as HTMLElement));
    gridEl.appendChild(cell);
  }

  layoutsEl.querySelectorAll('button').forEach((b) => {
    const l = layoutById(b.dataset.id!);
    b.classList.toggle('active', l.id === layout.id);
    b.disabled = l.cells.length < panes.length;
    b.title = b.disabled ? `${l.label} — önce pane kapat` : l.label;
  });

  panes.forEach((p) => p.queueFit());
  updateSummary();
}

function setLayout(l: Layout): void {
  if (l.cells.length < panes.length) return;
  layout = l;
  maximized = null;
  render();
  save();
}

// ---------- pane yönetimi ----------
function spawnSettings(restoring = false): SpawnSettings {
  const args = [settings.claudeArgs, restoring && settings.continueOnRestore ? '--continue' : '']
    .filter(Boolean)
    .join(' ');
  return { shell: settings.shell, autoClaude: settings.autoClaude, claudeArgs: args };
}

function addPane(cwd: string, name?: string, restoring = false): Pane | null {
  if (panes.length >= 8) return null;
  const p = new Pane(name ?? folderName(cwd), cwd, settings.fontSize, {
    onFocus: (x) => setFocus(x, false),
    onClose: closePane,
    onMaximize: toggleMax,
    onChange: save,
    onStatus,
  });
  byId.set(p.id, p);
  panes.push(p);
  layout = layoutFor(panes.length, layout);
  maximized = null;
  render();
  p.start(spawnSettings(restoring));
  if (!restoring) {
    remember(cwd);
    setFocus(p);
  }
  save();
  return p;
}

function closePane(p: Pane): void {
  const i = panes.indexOf(p);
  if (i < 0) return;
  panes.splice(i, 1);
  byId.delete(p.id);
  p.dispose();
  if (maximized === p) maximized = null;
  if (focused === p) focused = panes[Math.min(i, panes.length - 1)] ?? null;
  render();
  focused?.focus();
  save();
}

function setFocus(p: Pane, focusTerm = true): void {
  if (focused !== p) {
    focused = p;
    panes.forEach((x) => x.el.classList.toggle('focused', x === p));
    if (maximized && maximized !== p) {
      maximized = p;
      render();
    }
  }
  if (focusTerm) p.focus();
}

function toggleMax(p: Pane): void {
  maximized = maximized === p ? null : p;
  focused = p;
  render();
  p.focus();
}

function onStatus(p: Pane, prev: Status, next: Status): void {
  updateSummary();
  if (!settings.notifications) return;
  if (next === 'waiting') window.api.notify(`${p.name}: onay bekliyor`, 'Claude bir izin/cevap bekliyor.');
  else if (prev === 'working' && next === 'idle') window.api.notify(`${p.name}: tamamlandı`, 'Claude işini bitirdi, sıra sende.');
}

function updateSummary(): void {
  const count = (s: Status) => panes.filter((p) => p.status === s).length;
  const parts: string[] = [];
  const w = count('working'), q = count('waiting'), i = count('idle');
  if (w) parts.push(`<span class="s working"><i></i>${w} çalışıyor</span>`);
  if (q) parts.push(`<span class="s waiting"><i></i>${q} onay bekliyor</span>`);
  if (i) parts.push(`<span class="s idle"><i></i>${i} hazır</span>`);
  summaryEl.innerHTML = parts.join('');
  document.title = q ? `(${q}!) SuperAgent` : w ? `(${w}) SuperAgent` : 'SuperAgent';
}

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

function remember(cwd: string): void {
  recent = [cwd, ...recent.filter((r) => r.toLowerCase() !== cwd.toLowerCase())].slice(0, 8);
}

// ---------- yeni terminal menüsü ----------
function closeMenus(): void {
  newMenu.hidden = true;
  settingsMenu.hidden = true;
}

function place(menu: HTMLElement, anchor: HTMLElement): void {
  const r = anchor.getBoundingClientRect();
  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.min(r.left, innerWidth - w - 8)}px`;
  menu.style.top = `${Math.min(r.bottom + 4, innerHeight - h - 8)}px`;
  if (anchor.classList.contains('empty')) {
    menu.style.left = `${r.left + r.width / 2 - w / 2}px`;
    menu.style.top = `${r.top + r.height / 2 - h / 2}px`;
  }
}

function openNewMenu(anchor: HTMLElement): void {
  if (panes.length >= 8) return;
  closeMenus();
  const list = recent.length ? recent : [home];
  newMenu.innerHTML =
    `<div class="mh">Klasör seç</div>` +
    list
      .map((r, i) => `<button class="item" data-i="${i}"><span>${folderName(r)}</span><small>${r}</small></button>`)
      .join('') +
    `<div class="sep"></div><button class="item browse"><span>📁 Gözat…</span></button>`;
  newMenu.querySelectorAll<HTMLButtonElement>('.item[data-i]').forEach((b) =>
    b.addEventListener('click', () => {
      closeMenus();
      addPane(list[Number(b.dataset.i)]);
    }),
  );
  newMenu.querySelector('.browse')!.addEventListener('click', async () => {
    closeMenus();
    const dir = await window.api.pickFolder();
    if (dir) addPane(dir);
  });
  place(newMenu, anchor);
  (newMenu.querySelector('.item') as HTMLElement)?.focus();
}

// ---------- ayarlar ----------
function openSettings(anchor: HTMLElement): void {
  closeMenus();
  settingsMenu.innerHTML = `
    <div class="mh">Ayarlar</div>
    <label class="row"><span>Kabuk</span>
      <select name="shell">
        <option value="powershell">Windows PowerShell</option>
        <option value="pwsh">PowerShell 7 (pwsh)</option>
        <option value="cmd">Komut İstemi (cmd)</option>
      </select></label>
    <label class="row chk"><input type="checkbox" name="autoClaude"> Yeni terminalde <code>claude</code>'u otomatik başlat</label>
    <label class="row"><span>claude argümanları</span><input type="text" name="claudeArgs" placeholder="ör. --model opus"></label>
    <label class="row chk"><input type="checkbox" name="continueOnRestore"> Açılışta oturumları <code>--continue</code> ile sürdür</label>
    <label class="row chk"><input type="checkbox" name="notifications"> Bitince / onay isteyince bildirim gönder</label>
    <label class="row"><span>Yazı boyutu</span><input type="number" name="fontSize" min="9" max="24"></label>
    <div class="hint">Kısayollar: Ctrl+1…8 pane seç · Ctrl+Shift+Enter büyüt · Ctrl+Shift+T yeni · Ctrl+Shift+W kapat · Ctrl+= / Ctrl+- yazı boyutu</div>`;
  const f = (n: string) => settingsMenu.querySelector(`[name="${n}"]`) as HTMLInputElement;
  f('shell').value = settings.shell;
  f('autoClaude').checked = settings.autoClaude;
  f('claudeArgs').value = settings.claudeArgs;
  f('continueOnRestore').checked = settings.continueOnRestore;
  f('notifications').checked = settings.notifications;
  f('fontSize').value = String(settings.fontSize);
  settingsMenu.querySelectorAll('input, select').forEach((el) =>
    el.addEventListener('change', () => {
      settings = {
        shell: f('shell').value as Settings['shell'],
        autoClaude: f('autoClaude').checked,
        claudeArgs: f('claudeArgs').value.trim(),
        continueOnRestore: f('continueOnRestore').checked,
        notifications: f('notifications').checked,
        fontSize: clampFont(Number(f('fontSize').value)),
      };
      panes.forEach((p) => p.setFontSize(settings.fontSize));
      save();
    }),
  );
  place(settingsMenu, anchor);
  settingsMenu.style.left = `${innerWidth - settingsMenu.offsetWidth - 150}px`;
}

const clampFont = (n: number) => Math.min(24, Math.max(9, Number.isFinite(n) ? n : 13));

function changeFont(delta: number): void {
  settings.fontSize = clampFont(settings.fontSize + delta);
  panes.forEach((p) => p.setFontSize(settings.fontSize));
  save();
}

// ---------- toolbar & kısayollar ----------
layoutsEl.innerHTML = LAYOUTS.map((l) => `<button data-id="${l.id}">${layoutIcon(l)}</button>`).join('');
layoutsEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => setLayout(layoutById(b.dataset.id!))));
$('#btn-new').addEventListener('click', (e) => openNewMenu(e.currentTarget as HTMLElement));
$('#btn-settings').addEventListener('click', (e) => {
  if (!settingsMenu.hidden) return closeMenus();
  openSettings(e.currentTarget as HTMLElement);
});

document.addEventListener('mousedown', (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest('.menu') && !t.closest('#btn-new') && !t.closest('#btn-settings') && !t.closest('.empty')) closeMenus();
});

// Capture fazında dinleniyor: xterm tuşları yutmadan önce uygulama kısayolları yakalanır.
window.addEventListener(
  'keydown',
  (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) {
      if (e.key === 'Escape' && (!newMenu.hidden || !settingsMenu.hidden)) {
        closeMenus();
        focused?.focus();
        e.preventDefault();
      }
      return;
    }
    const k = e.key.toLowerCase();
    let handled = true;
    if (!e.shiftKey && /^[1-8]$/.test(e.key)) {
      const p = panes[Number(e.key) - 1];
      if (p) setFocus(p);
    } else if (e.shiftKey && k === 'enter') {
      if (focused) toggleMax(focused);
    } else if (e.shiftKey && k === 't') {
      openNewMenu(focused?.el ?? $('#btn-new'));
    } else if (e.shiftKey && k === 'w') {
      if (focused) closePane(focused);
    } else if (!e.shiftKey && (k === '=' || k === '+')) {
      changeFont(1);
    } else if (!e.shiftKey && k === '-') {
      changeFont(-1);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  },
  true,
);

// ---------- açılış ----------
(async () => {
  home = await window.api.home();
  const s = (await window.api.loadState()) as SavedState | null;
  if (s) {
    settings = { ...DEFAULTS, ...s.settings };
    recent = s.recent ?? [];
    layout = layoutById(s.layout);
    for (const p of s.panes ?? []) {
      const cwd = (await window.api.dirExists(p.cwd)) ? p.cwd : home;
      addPane(cwd, p.name, true);
    }
  }
  render();
  if (panes[0]) setFocus(panes[0]);
})();

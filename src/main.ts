import '@xterm/xterm/css/xterm.css';
import './styles.css';
import { Pane, type SearchHit, type SpawnSettings } from './pane';
import { LAYOUTS, layoutById, layoutFor, layoutIcon, type Layout } from './layouts';
import type { Status } from './status';

interface Settings extends SpawnSettings {
  continueOnRestore: boolean;
  notifications: boolean;
  fontSize: number;
}

interface PaneEntry {
  name: string;
  cwd: string;
  key: string;
}

interface Template {
  name: string;
  layout: string;
  panes: { name: string; cwd: string }[];
}

interface SavedState {
  layout: string;
  panes: (Omit<PaneEntry, 'key'> & { key?: string })[];
  recent: string[];
  closed?: PaneEntry[];
  templates?: Template[];
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

const MAX_PANES = 8;
const MAX_CLOSED = 10;

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const gridEl = $<HTMLElement>('#grid');
const layoutsEl = $<HTMLElement>('#layouts');
const summaryEl = $<HTMLElement>('#summary');
const newMenu = $<HTMLElement>('#new-menu');
const settingsMenu = $<HTMLElement>('#settings-menu');
const wsMenu = $<HTMLElement>('#ws-menu');
const searchEl = $<HTMLElement>('#search');
const searchInput = searchEl.querySelector('input')!;
const searchResults = searchEl.querySelector('.results') as HTMLElement;

let layout: Layout = LAYOUTS[4];
let panes: Pane[] = [];
let focused: Pane | null = null;
let maximized: Pane | null = null;
let recent: string[] = [];
let closed: PaneEntry[] = [];
let templates: Template[] = [];
let settings: Settings = { ...DEFAULTS };
let home = '';

const byId = new Map<string, Pane>();
const byKey = (key: string) => panes.find((p) => p.key === key);
// DevTools'ta (F12) hata ayıklama için.
Object.defineProperty(window, '__sa', { get: () => ({ panes, layout, settings, closed, templates }) });
window.api.pty.onData((id, data) => byId.get(id)?.write(data));
window.api.pty.onExit((id, code) => byId.get(id)?.exited(code));
window.api.onHook((e) => byKey(e.key)?.onHook(e));
// Bildirime tıklanınca o pane'e git.
window.api.onFocusPane((key) => {
  const p = byKey(key);
  if (p) setFocus(p);
});

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// ---------- kalıcılık ----------
let saveTimer = 0;
function save(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const s: SavedState = {
      layout: layout.id,
      panes: panes.map((p) => ({ name: p.name, cwd: p.cwd, key: p.key })),
      recent,
      closed,
      templates,
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
function spawnSettings(resume: string | null = null): SpawnSettings {
  return { shell: settings.shell, autoClaude: settings.autoClaude, claudeArgs: settings.claudeArgs, resume };
}

interface AddOptions {
  name?: string;
  key?: string;
  /** Sürdürülecek claude oturumu. */
  resume?: string | null;
  /** Kullanıcı açtıysa odakla ve son klasörlere ekle; açılışta geri yüklemede değil. */
  interactive?: boolean;
}

function addPane(cwd: string, o: AddOptions = {}): Pane | null {
  if (panes.length >= MAX_PANES) return null;
  const p = new Pane(o.name ?? folderName(cwd), cwd, o.key ?? crypto.randomUUID(), settings.fontSize, {
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
  p.start(spawnSettings(o.resume ?? null));
  if (o.interactive) {
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
  // Oturum kaydı hemen silinmez: Ctrl+Shift+Z ile geri açılabilsin.
  closed = [{ name: p.name, cwd: p.cwd, key: p.key }, ...closed];
  for (const old of closed.splice(MAX_CLOSED)) window.api.session.forget(old.key);
  if (maximized === p) maximized = null;
  if (focused === p) focused = panes[Math.min(i, panes.length - 1)] ?? null;
  render();
  focused?.focus();
  save();
}

/** Son kapatılan pane'i (ya da verileni) kendi claude oturumuyla geri açar. */
async function reopenClosed(entry: PaneEntry | undefined = closed[0]): Promise<void> {
  if (!entry || panes.length >= MAX_PANES) return;
  closed = closed.filter((c) => c !== entry);
  const cwd = (await window.api.dirExists(entry.cwd)) ? entry.cwd : home;
  const resume = await window.api.session.get({ key: entry.key, cwd });
  addPane(cwd, { name: entry.name, key: entry.key, resume, interactive: true });
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

/** Odaktaki pane'den sonra gelen, verilen durumdaki ilk pane'e geçer (sırayla döner). */
function focusNext(status: Status): boolean {
  const start = focused ? panes.indexOf(focused) : -1;
  for (let n = 1; n <= panes.length; n++) {
    const p = panes[(start + n) % panes.length];
    if (p.status === status) {
      setFocus(p);
      return true;
    }
  }
  return false;
}

function onStatus(p: Pane, prev: Status, next: Status): void {
  updateSummary();
  if (!settings.notifications) return;
  if (next === 'waiting') window.api.notify(`${p.name}: onay bekliyor`, 'Claude bir izin/cevap bekliyor.', p.key);
  else if (prev === 'working' && next === 'idle')
    window.api.notify(`${p.name}: tamamlandı`, 'Claude işini bitirdi, sıra sende.', p.key);
}

function updateSummary(): void {
  const count = (s: Status) => panes.filter((p) => p.status === s).length;
  const parts: string[] = [];
  const w = count('working'), q = count('waiting'), i = count('idle');
  const chip = (s: Status, n: number, label: string, hint: string) =>
    `<button class="s ${s}" data-status="${s}" title="${hint}"><i></i>${n} ${label}</button>`;
  if (w) parts.push(chip('working', w, 'çalışıyor', 'Sıradaki çalışan pane'));
  if (q) parts.push(chip('waiting', q, 'onay bekliyor', 'Sıradaki onay bekleyen pane (Ctrl+Shift+Space)'));
  if (i) parts.push(chip('idle', i, 'hazır', 'Sıradaki hazır pane'));
  summaryEl.innerHTML = parts.join('');
  document.title = q ? `(${q}!) SuperAgent` : w ? `(${w}) SuperAgent` : 'SuperAgent';
}
summaryEl.addEventListener('click', (e) => {
  const s = (e.target as HTMLElement).closest<HTMLElement>('[data-status]')?.dataset.status as Status | undefined;
  if (s) focusNext(s);
});

const folderName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

function remember(cwd: string): void {
  recent = [cwd, ...recent.filter((r) => !samePath(r, cwd))].slice(0, 8);
}

// ---------- menüler ----------
function closeMenus(): void {
  newMenu.hidden = true;
  settingsMenu.hidden = true;
  wsMenu.hidden = true;
  searchEl.hidden = true;
}

const anyMenuOpen = () => !newMenu.hidden || !settingsMenu.hidden || !wsMenu.hidden || !searchEl.hidden;

function place(menu: HTMLElement, anchor: HTMLElement | null): void {
  menu.hidden = false;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  if (!anchor || anchor.classList.contains('empty') || anchor.classList.contains('pane')) {
    const r = anchor?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    menu.style.left = `${Math.max(8, r.left + r.width / 2 - w / 2)}px`;
    menu.style.top = `${Math.max(44, r.top + r.height / 2 - h / 2)}px`;
    return;
  }
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, innerWidth - w - 8)}px`;
  menu.style.top = `${Math.min(r.bottom + 4, innerHeight - h - 8)}px`;
}

// ---------- yeni terminal menüsü ----------
function openNewMenu(anchor: HTMLElement): void {
  if (panes.length >= MAX_PANES) return;
  closeMenus();
  const list = recent.length ? recent : [home];
  const reopen = closed.slice(0, 3);
  newMenu.innerHTML =
    (reopen.length
      ? `<div class="mh">Son kapatılanlar</div>` +
        reopen
          .map(
            (c, i) =>
              `<button class="item" data-closed="${i}"><span>↺ ${esc(c.name)}${i === 0 ? ' <kbd>Ctrl+Shift+Z</kbd>' : ''}</span><small>${esc(c.cwd)}</small></button>`,
          )
          .join('') +
        `<div class="sep"></div>`
      : '') +
    `<div class="mh">Klasör seç</div>` +
    list
      .map((r, i) => `<button class="item" data-i="${i}"><span>${esc(folderName(r))}</span><small>${esc(r)}</small></button>`)
      .join('') +
    `<div class="sep"></div><button class="item browse"><span>📁 Gözat…</span></button>`;
  newMenu.querySelectorAll<HTMLButtonElement>('.item[data-closed]').forEach((b) =>
    b.addEventListener('click', () => {
      closeMenus();
      void reopenClosed(reopen[Number(b.dataset.closed)]);
    }),
  );
  newMenu.querySelectorAll<HTMLButtonElement>('.item[data-i]').forEach((b) =>
    b.addEventListener('click', () => {
      closeMenus();
      void openFolder(list[Number(b.dataset.i)], anchor);
    }),
  );
  newMenu.querySelector('.browse')!.addEventListener('click', async () => {
    closeMenus();
    const dir = await window.api.pickFolder();
    if (dir) void openFolder(dir, anchor);
  });
  place(newMenu, anchor);
  (newMenu.querySelector('.item') as HTMLElement)?.focus();
}

/**
 * Klasörü yeni pane'de açar. Aynı depo başka bir pane'de zaten açıksa iki Claude'un
 * aynı dosyaları ezmemesi için ayrı bir worktree önerir.
 */
async function openFolder(cwd: string, anchor: HTMLElement | null): Promise<void> {
  const info = await window.api.git.info(cwd);
  if (info) await Promise.all(panes.filter((p) => !p.git).map((p) => p.refreshGit()));
  const same = info ? panes.filter((p) => p.git && samePath(p.git.common, info.common)) : [];
  if (!info || !same.length) {
    addPane(cwd, { interactive: true });
    return;
  }
  closeMenus();
  const repo = folderName(info.root);
  const show = (name: string, error = '') => {
    newMenu.innerHTML = `
      <div class="mh">Bu depo zaten açık</div>
      <p class="note"><b>${esc(same.map((p) => p.name).join(', '))}</b> aynı depoda çalışıyor. İki Claude aynı dosyaları
        düzenlerse birbirinin değişikliğini ezebilir.</p>
      <div class="wt">
        <input type="text" value="${esc(name)}" spellcheck="false" />
        <button class="primary">Yeni worktree'de aç</button>
      </div>
      <p class="note dim">${esc(repo)}-<span class="nm">${esc(name)}</span> klasöründe, <code>superagent/<span class="nm">${esc(name)}</span></code> dalıyla açılır.</p>
      ${error ? `<p class="note err">${esc(error)}</p>` : ''}
      <div class="sep"></div>
      <button class="item same"><span>Yine de aynı klasörde aç</span></button>`;
    const input = newMenu.querySelector('input')!;
    const go = async () => {
      const btn = newMenu.querySelector<HTMLButtonElement>('.primary')!;
      btn.disabled = true;
      btn.textContent = 'Oluşturuluyor…';
      const r = await window.api.git.worktree(info.root, input.value.trim());
      if ('error' in r) return show(input.value.trim(), r.error);
      closeMenus();
      addPane(r.path, { name: `${repo} · ${input.value.trim()}`, interactive: true });
    };
    input.addEventListener('input', () => newMenu.querySelectorAll('.nm').forEach((n) => (n.textContent = input.value.trim())));
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void go();
      if (e.key === 'Escape') closeMenus();
    });
    newMenu.querySelector('.primary')!.addEventListener('click', () => void go());
    newMenu.querySelector('.same')!.addEventListener('click', () => {
      closeMenus();
      addPane(cwd, { interactive: true });
    });
    place(newMenu, anchor?.isConnected ? anchor : null);
    input.focus();
    input.select();
  };
  let n = same.length + 1;
  while (panes.some((p) => p.name === `${repo} · paralel-${n}`)) n++;
  show(`paralel-${n}`);
}

// ---------- çalışma alanları (şablonlar) ----------
function openWorkspaces(anchor: HTMLElement): void {
  closeMenus();
  wsMenu.innerHTML =
    `<div class="mh">Çalışma alanları</div>` +
    (templates.length
      ? templates
          .map(
            (t, i) => `<div class="ws-row">
              <button class="item" data-open="${i}"><span>${esc(t.name)}</span><small>${t.panes.map((p) => esc(p.name)).join(' · ')}</small></button>
              <button class="del" data-del="${i}" title="Sil">✕</button>
            </div>`,
          )
          .join('')
      : `<p class="note dim">Henüz kayıtlı alan yok. Açık pane'leri ve düzeni bir adla kaydedip tek tıkla yeniden açabilirsin.</p>`) +
    `<div class="sep"></div>
     <div class="wt">
       <input type="text" placeholder="Bu düzeni kaydet: ad" spellcheck="false" ${panes.length ? '' : 'disabled'} />
       <button class="primary" ${panes.length ? '' : 'disabled'}>Kaydet</button>
     </div>`;
  wsMenu.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) =>
    b.addEventListener('click', () => void openTemplate(templates[Number(b.dataset.open)])),
  );
  wsMenu.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) =>
    b.addEventListener('click', () => {
      templates.splice(Number(b.dataset.del), 1);
      save();
      openWorkspaces(anchor);
    }),
  );
  const input = wsMenu.querySelector('input')!;
  const saveTemplate = () => {
    const name = input.value.trim();
    if (!name || !panes.length) return input.focus();
    const t: Template = { name, layout: layout.id, panes: panes.map((p) => ({ name: p.name, cwd: p.cwd })) };
    templates = [t, ...templates.filter((x) => x.name !== name)];
    save();
    openWorkspaces(anchor);
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') saveTemplate();
    if (e.key === 'Escape') closeMenus();
  });
  wsMenu.querySelector('.primary')!.addEventListener('click', saveTemplate);
  place(wsMenu, anchor);
}

async function openTemplate(t: Template): Promise<void> {
  closeMenus();
  if (
    panes.length &&
    !confirm(`Açık ${panes.length} pane kapatılıp "${t.name}" açılsın mı?\nKapatılanlar Ctrl+Shift+Z ile geri açılabilir.`)
  )
    return;
  for (const p of [...panes].reverse()) closePane(p);
  layout = layoutById(t.layout);
  for (const p of t.panes) {
    const cwd = (await window.api.dirExists(p.cwd)) ? p.cwd : home;
    addPane(cwd, { name: p.name });
  }
  render();
  if (panes[0]) setFocus(panes[0]);
}

// ---------- tüm pane'lerde arama ----------
let hits: { pane: Pane; hit: SearchHit }[] = [];
let selected = 0;

function openSearch(): void {
  closeMenus();
  searchEl.hidden = false;
  searchInput.focus();
  searchInput.select();
  runSearch();
}

function runSearch(): void {
  const q = searchInput.value;
  hits = [];
  selected = 0;
  if (q.trim().length < 2) {
    searchResults.innerHTML = `<p class="note dim">En az 2 karakter yaz. Tüm pane'lerin geçmişinde aranır.</p>`;
    return;
  }
  for (const pane of panes) for (const hit of pane.search(q, 15)) hits.push({ pane, hit });
  if (!hits.length) {
    searchResults.innerHTML = `<p class="note dim">Sonuç yok.</p>`;
    return;
  }
  let last: Pane | null = null;
  searchResults.innerHTML = hits
    .map(({ pane, hit }, i) => {
      const head = pane !== last ? `<div class="grp">${panes.indexOf(pane) + 1} · ${esc(pane.name)}</div>` : '';
      last = pane;
      const from = Math.max(0, hit.col - 40);
      const text = hit.text.slice(from, hit.col + q.length + 80);
      const at = hit.col - from;
      const line = `${from ? '…' : ''}${esc(text.slice(0, at))}<mark>${esc(text.slice(at, at + q.length))}</mark>${esc(text.slice(at + q.length))}`;
      return `${head}<button class="hit" data-i="${i}">${line}</button>`;
    })
    .join('');
  markSelected();
}

function markSelected(): void {
  searchResults.querySelectorAll('.hit').forEach((b, i) => b.classList.toggle('sel', i === selected));
  searchResults.querySelector('.hit.sel')?.scrollIntoView({ block: 'nearest' });
}

function openHit(i: number): void {
  const h = hits[i];
  if (!h) return;
  closeMenus();
  setFocus(h.pane);
  h.pane.reveal(h.hit, searchInput.value.length);
}

let searchTimer = 0;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, 120);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.ctrlKey) return; // uygulama kısayolları çalışsın
  e.stopPropagation();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (hits.length) selected = (selected + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
    markSelected();
  } else if (e.key === 'Enter') openHit(selected);
  else if (e.key === 'Escape') {
    closeMenus();
    focused?.focus();
  }
});
searchResults.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('.hit');
  if (b) openHit(Number(b.dataset.i));
});

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
    <label class="row chk"><input type="checkbox" name="continueOnRestore"> Açılışta her pane kendi Claude oturumunu sürdürsün</label>
    <label class="row chk"><input type="checkbox" name="notifications"> Bitince / onay isteyince bildirim gönder</label>
    <label class="row"><span>Yazı boyutu</span><input type="number" name="fontSize" min="9" max="24"></label>
    <div class="hint">Kısayollar: Ctrl+1…8 pane seç · Ctrl+Shift+Space sıradaki onay bekleyen · Ctrl+Shift+Enter büyüt ·
      Ctrl+Shift+T yeni · Ctrl+Shift+W kapat · Ctrl+Shift+Z kapatılanı geri aç · Ctrl+Shift+F tüm pane'lerde ara ·
      Ctrl+= / Ctrl+- yazı boyutu</div>`;
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
$('#btn-ws').addEventListener('click', (e) => {
  if (!wsMenu.hidden) return closeMenus();
  openWorkspaces(e.currentTarget as HTMLElement);
});
$('#btn-search').addEventListener('click', () => (searchEl.hidden ? openSearch() : closeMenus()));
$('#btn-settings').addEventListener('click', (e) => {
  if (!settingsMenu.hidden) return closeMenus();
  openSettings(e.currentTarget as HTMLElement);
});

document.addEventListener('mousedown', (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest('.menu, #search, #topbar button, .empty')) closeMenus();
});

// Pane dışına bırakılan dosya pencereyi o dosyaya yönlendirmesin.
for (const ev of ['dragover', 'drop'] as const) document.addEventListener(ev, (e) => e.preventDefault());

// Capture fazında dinleniyor: xterm tuşları yutmadan önce uygulama kısayolları yakalanır.
window.addEventListener(
  'keydown',
  (e) => {
    if (!e.ctrlKey || e.altKey || e.metaKey) {
      if (e.key === 'Escape' && anyMenuOpen()) {
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
    } else if (e.shiftKey && e.code === 'Space') {
      focusNext('waiting');
    } else if (e.shiftKey && k === 't') {
      openNewMenu(focused?.el ?? $('#btn-new'));
    } else if (e.shiftKey && k === 'w') {
      if (focused) closePane(focused);
    } else if (e.shiftKey && k === 'z') {
      void reopenClosed();
    } else if (e.shiftKey && k === 'f') {
      openSearch();
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
    closed = s.closed ?? [];
    templates = s.templates ?? [];
    layout = layoutById(s.layout);
    const saved = await Promise.all(
      (s.panes ?? []).map(async (p) => ({
        name: p.name,
        cwd: (await window.api.dirExists(p.cwd)) ? p.cwd : home,
        key: p.key ?? crypto.randomUUID(),
      })),
    );
    // Her pane'in kendi oturum kimliği; iki pane asla aynı oturumu almaz.
    const resumes = await window.api.session.resolve(
      saved.map(({ key, cwd }) => ({ key, cwd })),
      closed.map((c) => c.key),
    );
    saved.forEach((p, i) => addPane(p.cwd, { name: p.name, key: p.key, resume: settings.continueOnRestore ? resumes[i] : null }));
  }
  render();
  if (panes[0]) setFocus(panes[0]);
})();

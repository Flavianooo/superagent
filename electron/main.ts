import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PtyManager, type CreateOptions } from './ptyManager';

let win: BrowserWindow | null = null;
const statePath = () => path.join(app.getPath('userData'), 'state.json');

const ptys = new PtyManager(
  (id, data) => win?.webContents.send('pty:data', id, data),
  (id, code) => win?.webContents.send('pty:exit', id, code),
);

function createWindow(): void {
  win = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#0d0f12',
    title: 'SuperAgent',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d0f12', symbolColor: '#8b949e', height: 36 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Pencere arka plandayken de durum takibi (ve bildirimler) aksamasın.
      backgroundThrottling: false,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.on('focus', () => win?.flashFrame(false));
  // Terminaldeki linkler varsayılan tarayıcıda açılsın, uygulama içinde değil.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win?.webContents.toggleDevTools();
  });
  // Arayüz yeniden yüklenirse sahipsiz kalan terminalleri kapat.
  win.webContents.on('did-start-loading', () => ptys.killAll());
  win.on('closed', () => {
    win = null;
    ptys.killAll();
  });
}

ipcMain.on('pty:create', (_e, o: CreateOptions) => {
  try {
    ptys.create(o);
  } catch (err) {
    win?.webContents.send('pty:data', o.id, `\r\n\x1b[31mTerminal başlatılamadı: ${String(err)}\x1b[0m\r\n`);
    win?.webContents.send('pty:exit', o.id, -1);
  }
});
ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data));
ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows));
ipcMain.on('pty:kill', (_e, id: string) => ptys.kill(id));

ipcMain.handle('dialog:pickFolder', async () => {
  if (!win) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('state:load', () => {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return null;
  }
});
ipcMain.on('state:save', (_e, state: unknown) => {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
  } catch {
    /* yoksay */
  }
});

ipcMain.handle('clipboard:read', async () => ({
  text: await clipboard.readText(),
  hasImage: await clipboard.has('image/png').catch(() => false),
}));
ipcMain.on('clipboard:write', (_e, text: string) => void clipboard.writeText(text));

ipcMain.handle('home', () => app.getPath('home'));
ipcMain.handle('dir:exists', (_e, p: string) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
});

// Pencere odakta değilken bir session bittiğinde / onay istediğinde haber ver.
ipcMain.on('notify', (_e, title: string, body: string) => {
  if (!win || win.isFocused()) return;
  win.flashFrame(true);
  if (Notification.isSupported()) {
    const n = new Notification({ title, body });
    n.on('click', () => {
      win?.show();
      win?.focus();
    });
    n.show();
  }
});

app.setAppUserModelId('SuperAgent');
app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  ptys.killAll();
  app.quit();
});

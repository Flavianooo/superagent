import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { HookEvent } from './hooks';
import type { GitInfo } from './git';

const api = {
  pty: {
    create: (o: unknown) => ipcRenderer.send('pty:create', o),
    write: (id: string, data: string) => ipcRenderer.send('pty:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id: string) => ipcRenderer.send('pty:kill', id),
    onData: (fn: (id: string, data: string) => void) => {
      ipcRenderer.on('pty:data', (_e, id, data) => fn(id, data));
    },
    onExit: (fn: (id: string, code: number) => void) => {
      ipcRenderer.on('pty:exit', (_e, id, code) => fn(id, code));
    },
  },
  session: {
    // Açılışta her pane için sürdürülecek claude oturumu (yoksa null).
    // keep: kapatılmış ama geri açılabilecek pane'lerin anahtarları (kayıtları silinmesin).
    resolve: (panes: { key: string; cwd: string }[], keep: string[]): Promise<(string | null)[]> =>
      ipcRenderer.invoke('session:resolve', panes, keep),
    get: (p: { key: string; cwd: string }): Promise<string | null> => ipcRenderer.invoke('session:get', p),
    forget: (key: string) => ipcRenderer.send('session:forget', key),
  },
  git: {
    info: (cwd: string): Promise<GitInfo | null> => ipcRenderer.invoke('git:info', cwd),
    worktree: (root: string, name: string): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke('git:worktree', root, name),
  },
  onHook: (fn: (e: HookEvent) => void) => {
    ipcRenderer.on('pane:hook', (_e, ev) => fn(ev));
  },
  onFocusPane: (fn: (key: string) => void) => {
    ipcRenderer.on('pane:focus', (_e, key) => fn(key));
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  loadState: (): Promise<unknown> => ipcRenderer.invoke('state:load'),
  saveState: (s: unknown) => ipcRenderer.send('state:save', s),
  readClipboard: (): Promise<{ text: string; hasImage: boolean }> => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (t: string) => ipcRenderer.send('clipboard:write', t),
  home: (): Promise<string> => ipcRenderer.invoke('home'),
  dirExists: (p: string): Promise<boolean> => ipcRenderer.invoke('dir:exists', p),
  notify: (title: string, body: string, paneKey?: string) => ipcRenderer.send('notify', title, body, paneKey),
  // contextIsolation açıkken File.path yok; sürüklenen dosyanın disk yolunu buradan alırız.
  pathForFile: (f: File): string => webUtils.getPathForFile(f),
};

contextBridge.exposeInMainWorld('api', api);
export type Api = typeof api;

import { contextBridge, ipcRenderer, webUtils } from 'electron';

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
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),
  loadState: (): Promise<unknown> => ipcRenderer.invoke('state:load'),
  saveState: (s: unknown) => ipcRenderer.send('state:save', s),
  readClipboard: (): Promise<{ text: string; hasImage: boolean }> => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (t: string) => ipcRenderer.send('clipboard:write', t),
  home: (): Promise<string> => ipcRenderer.invoke('home'),
  dirExists: (p: string): Promise<boolean> => ipcRenderer.invoke('dir:exists', p),
  notify: (title: string, body: string) => ipcRenderer.send('notify', title, body),
  // contextIsolation açıkken File.path yok; sürüklenen dosyanın disk yolunu buradan alırız.
  pathForFile: (f: File): string => webUtils.getPathForFile(f),
};

contextBridge.exposeInMainWorld('api', api);
export type Api = typeof api;

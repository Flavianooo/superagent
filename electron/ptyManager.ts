import * as pty from '@lydell/node-pty';

export type Shell = 'powershell' | 'pwsh' | 'cmd';

export interface CreateOptions {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  shell: Shell;
  autoClaude: boolean;
  claudeArgs: string;
}

type DataFn = (id: string, data: string) => void;
type ExitFn = (id: string, code: number) => void;

// PTY çıktısını ~16ms'de bir toplu gönderir; 8 pane aynı anda akarken IPC trafiğini düşük tutar.
const FLUSH_MS = 16;

export class PtyManager {
  private ptys = new Map<string, pty.IPty>();
  private buffers = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private onData: DataFn, private onExit: ExitFn) {}

  create(o: CreateOptions): void {
    this.kill(o.id);
    const { file, args } = shellCommand(o);
    const env = cleanEnv();
    const p = pty.spawn(file, args, {
      name: 'xterm-256color',
      cwd: o.cwd,
      cols: Math.max(2, o.cols),
      rows: Math.max(2, o.rows),
      env,
      useConpty: true,
    });
    this.ptys.set(o.id, p);
    p.onData((d) => {
      this.buffers.set(o.id, (this.buffers.get(o.id) ?? '') + d);
      this.schedule();
    });
    p.onExit(({ exitCode }) => {
      this.flush();
      if (this.ptys.get(o.id) !== p) return; // yeniden başlatıldı ya da kapatıldı
      this.ptys.delete(o.id);
      this.onExit(o.id, exitCode);
    });
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.ptys.get(id)?.resize(Math.max(2, cols), Math.max(2, rows));
    } catch {
      /* process zaten kapanmış olabilir */
    }
  }

  kill(id: string): void {
    const p = this.ptys.get(id);
    if (!p) return;
    this.ptys.delete(id);
    this.buffers.delete(id);
    try {
      p.kill();
    } catch {
      /* yoksay */
    }
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id);
  }

  private schedule(): void {
    if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const [id, data] of this.buffers) if (data && this.ptys.has(id)) this.onData(id, data);
    this.buffers.clear();
  }
}

// Uygulama bir Claude Code oturumunun içinden başlatıldıysa o oturumun değişkenleri
// (renk kapatma, başlık kapatma, child-session işaretleri) yeni claude'lara sızmasın.
function cleanEnv(): Record<string, string> {
  const env = { ...process.env, COLORTERM: 'truecolor', TERM_PROGRAM: 'SuperAgent' } as Record<string, string>;
  delete env.ELECTRON_RUN_AS_NODE;
  if (env.CLAUDECODE) {
    for (const k of Object.keys(env)) {
      if (/^CLAUDE_CODE_|^CLAUDECODE$|^CLAUDE_PID$|^CLAUDE_AGENT_SDK_|^CLAUDE_PREVIEW_/.test(k)) delete env[k];
    }
    delete env.NO_COLOR;
  }
  return env;
}

function shellCommand(o: CreateOptions): { file: string; args: string[] } {
  const claude = ['claude', o.claudeArgs.trim()].filter(Boolean).join(' ');
  switch (o.shell) {
    case 'cmd':
      return { file: 'cmd.exe', args: o.autoClaude ? ['/k', claude] : [] };
    case 'pwsh':
      return { file: 'pwsh.exe', args: o.autoClaude ? ['-NoLogo', '-NoExit', '-Command', claude] : ['-NoLogo'] };
    default:
      return { file: 'powershell.exe', args: o.autoClaude ? ['-NoLogo', '-NoExit', '-Command', claude] : ['-NoLogo'] };
  }
}

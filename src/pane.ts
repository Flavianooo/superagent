import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { detect, STATUS_LABEL, type Status } from './status';

export const THEME: ITheme = {
  background: '#101317',
  foreground: '#d6dae0',
  cursor: '#c9d1ff',
  cursorAccent: '#101317',
  selectionBackground: '#2d3a5a',
  black: '#1b1f25',
  red: '#f07178',
  green: '#9ece6a',
  yellow: '#e5c07b',
  blue: '#7aa2f7',
  magenta: '#c49cf7',
  cyan: '#73daca',
  white: '#c0c6d0',
  brightBlack: '#5c6370',
  brightRed: '#ff8b92',
  brightGreen: '#b5e48c',
  brightYellow: '#f0d399',
  brightBlue: '#9bb8ff',
  brightMagenta: '#d7b8ff',
  brightCyan: '#94efe0',
  brightWhite: '#f2f4f8',
};

export interface SpawnSettings {
  shell: 'powershell' | 'pwsh' | 'cmd';
  autoClaude: boolean;
  claudeArgs: string;
}

export interface PaneEvents {
  onFocus(p: Pane): void;
  onClose(p: Pane): void;
  onMaximize(p: Pane): void;
  onChange(): void;
  onStatus(p: Pane, prev: Status, next: Status): void;
}

let seq = 0;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export class Pane {
  readonly id = `p${Date.now().toString(36)}${seq++}`;
  readonly el: HTMLElement;
  readonly term: Terminal;
  status: Status = 'starting';
  private fit = new FitAddon();
  private body: HTMLElement;
  private overlay: HTMLElement;
  private title = '';
  private candidate: Status = 'starting';
  private candidateSince = 0;
  private poll: number;
  private ro: ResizeObserver;
  private fitQueued = false;
  private started = false;

  constructor(
    public name: string,
    public cwd: string,
    fontSize: number,
    private events: PaneEvents,
  ) {
    this.el = document.createElement('section');
    this.el.className = 'pane';
    this.el.dataset.status = this.status;
    this.el.innerHTML = `
      <header>
        <span class="dot"></span>
        <span class="idx"></span>
        <span class="name" title="Yeniden adlandırmak için çift tıkla"></span>
        <span class="cwd"></span>
        <span class="ttl"></span>
        <span class="st"></span>
        <button class="b-restart" title="Yeniden başlat">⟳</button>
        <button class="b-max" title="Büyüt / küçült (Ctrl+Shift+Enter)">⤢</button>
        <button class="b-close" title="Kapat (Ctrl+Shift+W)">✕</button>
      </header>
      <div class="body"></div>
      <div class="overlay"><div>Oturum kapandı</div><button>Yeniden başlat</button></div>`;
    this.body = this.el.querySelector('.body')!;
    this.overlay = this.el.querySelector('.overlay')!;
    this.renderHeader();

    this.term = new Terminal({
      theme: THEME,
      fontFamily: "'Cascadia Mono', 'Cascadia Code', Consolas, monospace",
      fontSize,
      lineHeight: 1.1,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      macOptionIsMeta: true,
    });
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri)));

    this.term.onData((d) => window.api.pty.write(this.id, d));
    this.term.onTitleChange((t) => {
      this.title = t;
      this.renderHeader();
    });
    this.term.attachCustomKeyEventHandler((e) => this.handleKey(e));

    this.el.addEventListener('mousedown', () => this.events.onFocus(this));
    this.body.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.term.hasSelection()) this.copySelection();
      else this.paste();
    });

    // Dosya sürükle-bırak: Windows Terminal gibi yolu yapıştırır; Claude görsel/PDF yollarını eke çevirir.
    this.el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.el.classList.add('dropping');
    });
    this.el.addEventListener('dragleave', (e) => {
      if (!this.el.contains(e.relatedTarget as Node)) this.el.classList.remove('dropping');
    });
    this.el.addEventListener('drop', (e) => {
      e.preventDefault();
      this.el.classList.remove('dropping');
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.api.pathForFile(f)).filter(Boolean);
      if (!paths.length) return;
      this.term.paste(paths.map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ') + ' ');
      this.events.onFocus(this);
      this.term.focus();
    });

    const header = this.el.querySelector('header')!;
    header.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).classList.contains('name')) this.rename();
      else if (!(e.target as HTMLElement).closest('button')) this.events.onMaximize(this);
    });
    this.el.querySelector('.b-close')!.addEventListener('click', () => this.events.onClose(this));
    this.el.querySelector('.b-max')!.addEventListener('click', () => this.events.onMaximize(this));
    this.el.querySelector('.b-restart')!.addEventListener('click', () => this.restart());
    this.overlay.querySelector('button')!.addEventListener('click', () => this.restart());

    this.ro = new ResizeObserver(() => this.queueFit());
    this.ro.observe(this.body);
    this.poll = window.setInterval(() => this.checkStatus(), 400);
  }

  private spawnSettings: SpawnSettings | null = null;

  /** DOM'a eklendikten sonra çağrılır: terminali boyutlandırıp PTY'yi başlatır. */
  start(s: SpawnSettings): void {
    this.mount();
    this.spawnSettings = s;
    this.started = true;
    this.fitNow();
    this.setStatus('starting');
    this.overlay.classList.remove('show');
    window.api.pty.create({
      id: this.id,
      cwd: this.cwd,
      cols: this.term.cols,
      rows: this.term.rows,
      ...s,
    });
  }

  private mounted = false;

  // xterm'i ve WebGL renderer'ı ancak pane DOM'a eklendikten sonra açıyoruz;
  // bağlı olmayan bir elemanda açılırsa WebGL tuvali boş kalabiliyor.
  private mount(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.term.open(this.body);
    this.term.textarea?.addEventListener('focus', () => this.events.onFocus(this));
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      this.term.loadAddon(gl);
    } catch {
      /* WebGL yoksa DOM renderer ile devam */
    }
  }

  restart(s?: SpawnSettings): void {
    const settings = s ?? this.spawnSettings;
    if (!settings) return;
    window.api.pty.kill(this.id);
    this.term.reset();
    this.title = '';
    this.start({ ...settings, claudeArgs: settings.claudeArgs.replace(/\s*--continue\b/, '') });
    this.term.focus();
  }

  write(data: string): void {
    this.term.write(data);
  }

  exited(code: number): void {
    this.setStatus('exited');
    this.overlay.querySelector('div')!.textContent = `Oturum kapandı (çıkış kodu ${code})`;
    this.overlay.classList.add('show');
  }

  setIndex(i: number): void {
    (this.el.querySelector('.idx') as HTMLElement).textContent = String(i + 1);
  }

  setFontSize(size: number): void {
    this.term.options.fontSize = size;
    this.queueFit();
  }

  focus(): void {
    this.term.focus();
  }

  dispose(): void {
    clearInterval(this.poll);
    this.ro.disconnect();
    window.api.pty.kill(this.id);
    this.term.dispose();
    this.el.remove();
  }

  queueFit(): void {
    if (this.fitQueued) return;
    this.fitQueued = true;
    requestAnimationFrame(() => {
      this.fitQueued = false;
      this.fitNow();
    });
  }

  private fitNow(): void {
    if (!this.mounted || this.body.clientWidth < 20 || this.body.clientHeight < 20) return; // gizli pane
    const { cols, rows } = this.term;
    try {
      this.fit.fit();
    } catch {
      return;
    }
    if (this.started && (cols !== this.term.cols || rows !== this.term.rows)) {
      window.api.pty.resize(this.id, this.term.cols, this.term.rows);
    }
    // Gizliyken (büyütülmüş başka pane) WebGL tuvali güncellenmez; görünür olunca yeniden çiz.
    this.term.refresh(0, this.term.rows - 1);
  }

  private handleKey(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
    const key = e.key.toLowerCase();
    // Seçim varken Ctrl+C kopyalar (Windows Terminal gibi), yoksa Claude'a kesme sinyali gider.
    if (ctrl && key === 'c' && (e.shiftKey || this.term.hasSelection())) {
      if (e.type === 'keydown') this.copySelection();
      e.preventDefault();
      return false;
    }
    if (ctrl && key === 'v') {
      if (e.type === 'keydown') this.paste();
      e.preventDefault();
      return false;
    }
    return true;
  }

  private copySelection(): void {
    const text = this.term.getSelection();
    if (text) window.api.writeClipboard(text);
    this.term.clearSelection();
  }

  private async paste(): Promise<void> {
    const { text, hasImage } = await window.api.readClipboard();
    if (text) this.term.paste(text);
    // Panoda sadece görsel varsa Ctrl+V'yi Claude'a ilet; görseli kendisi okur.
    else if (hasImage) window.api.pty.write(this.id, '\x16');
    this.term.focus();
  }

  private rename(): void {
    const span = this.el.querySelector('.name') as HTMLElement;
    const input = document.createElement('input');
    input.className = 'rename';
    input.value = this.name;
    span.replaceWith(input);
    input.focus();
    input.select();
    const done = (save: boolean) => {
      if (save && input.value.trim()) this.name = input.value.trim();
      input.replaceWith(span);
      this.renderHeader();
      this.events.onChange();
      this.term.focus();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => input.isConnected && done(true));
  }

  private screenText(): string {
    const buf = this.term.buffer.active;
    const lines: string[] = [];
    const end = buf.baseY + this.term.rows;
    for (let y = Math.max(0, end - this.term.rows); y < end; y++) {
      const line = buf.getLine(y);
      if (line) lines.push(line.translateToString(true));
    }
    return lines.join('\n');
  }

  private checkStatus(): void {
    if (this.status === 'exited' || !this.started) return;
    const now = Date.now();
    const s = detect(this.screenText(), this.title);
    if (s !== this.candidate) {
      this.candidate = s;
      this.candidateSince = now;
    }
    // "Hazır"a geçişi biraz geciktir: spinner kareleri arasındaki anlık boşluklar yanlış bildirim üretmesin.
    const hold = s === 'idle' ? 1500 : 300;
    if (this.candidate !== this.status && now - this.candidateSince >= hold) this.setStatus(this.candidate);
  }

  private setStatus(next: Status): void {
    const prev = this.status;
    if (prev === next) return;
    this.status = next;
    this.el.dataset.status = next;
    this.renderHeader();
    if (prev === 'working' && next === 'idle') {
      this.el.classList.remove('flash');
      void this.el.offsetWidth;
      this.el.classList.add('flash');
    }
    this.events.onStatus(this, prev, next);
  }

  private renderHeader(): void {
    const q = (s: string) => this.el.querySelector(s) as HTMLElement | null;
    const nameEl = q('.name');
    if (nameEl) nameEl.textContent = this.name;
    const home = this.cwd.replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
    q('.cwd')!.innerHTML = esc(home);
    q('.cwd')!.title = this.cwd;
    const t = this.title.replace(/^[⠀-⣿·✢✶✻✽✺✳*]\s*/, '');
    // Kabuğun kendi başlığı (ör. powershell.exe yolu) gürültü; sadece Claude'un görev başlığını göster.
    const noise = !t || t === 'Claude Code' || /\.exe$|^[A-Za-z]:\\|^Administrator:|^Yönetici:/i.test(t);
    q('.ttl')!.textContent = noise ? '' : t;
    q('.st')!.textContent = STATUS_LABEL[this.status];
  }
}

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Her pane kalıcı bir anahtar taşır; o pane'deki claude'un oturum kimliği
// sessions/<anahtar> dosyasında durur. Claude'a --settings ile verilen SessionStart
// hook'u /clear, /resume vb. sonrası değişen kimliği bu dosyaya yazar. Açılışta her
// pane kendi kimliğiyle --resume edilir; --continue gibi "en son oturum" tahmini yok.

export interface PaneRef {
  key: string;
  cwd: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9-]{1,64}$/;

const root = () => path.join(app.getPath('userData'), 'claude');
const sessionsDir = () => path.join(root(), 'sessions');
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
// Claude Code proje klasörlerini yoldaki harf/rakam dışı her karakteri '-' yaparak adlandırır.
const projectDir = (cwd: string) => path.join(claudeDir(), 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));

export const sessionFile = (key: string) => (KEY.test(key) ? path.join(sessionsDir(), key) : null);

const HOOK_PS1 = `$f = $env:SUPERAGENT_SESSION_FILE
if (-not $f) { exit 0 }
try {
  $j = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($j.session_id) { [IO.File]::WriteAllText($f, [string]$j.session_id) }
} catch {}
exit 0
`;

// Durum olayları: istem gönderildi / araç çalışıyor → çalışıyor, izin istendi → onay bekliyor, bitti → hazır.
const STATUS_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop'];

/**
 * Hook betiğini ve claude'a --settings ile verilecek dosyayı yazar; settings dosyasının yolunu döner.
 * SessionStart (oturum kimliği) komut hook'u; durum olayları uygulamanın yerel HTTP sunucusuna gider.
 */
export function ensureHookSettings(statusUrl: string | null): string {
  const dir = root();
  fs.mkdirSync(sessionsDir(), { recursive: true });
  const ps1 = path.join(dir, 'session-hook.ps1');
  const settings = path.join(dir, 'settings.json');
  const command = `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${ps1.replace(/\\/g, '/')}"`;
  const hooks: Record<string, unknown[]> = { SessionStart: [{ hooks: [{ type: 'command', command, timeout: 15 }] }] };
  if (statusUrl) {
    const http = {
      type: 'http',
      url: statusUrl,
      timeout: 5,
      headers: { 'X-SuperAgent-Pane': '$SUPERAGENT_PANE' },
      allowedEnvVars: ['SUPERAGENT_PANE'],
    };
    for (const e of STATUS_EVENTS) hooks[e] = [{ hooks: [http] }];
  }
  const json = JSON.stringify({ hooks }, null, 2);
  writeIfChanged(ps1, HOOK_PS1);
  writeIfChanged(settings, json);
  return settings;
}

function writeIfChanged(file: string, content: string): void {
  try {
    if (fs.readFileSync(file, 'utf8') === content) return;
  } catch {
    /* yok */
  }
  fs.writeFileSync(file, content);
}

function readSession(key: string): string | null {
  const f = sessionFile(key);
  if (!f) return null;
  try {
    const id = fs.readFileSync(f, 'utf8').trim();
    return UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Yeni ya da sürdürülen oturumun kimliğini pane'e kaydeder (hook çalışmasa da elimizde olsun). */
export function writeSession(key: string, id: string): void {
  const f = sessionFile(key);
  if (!f) return;
  try {
    fs.mkdirSync(sessionsDir(), { recursive: true });
    fs.writeFileSync(f, id);
  } catch {
    /* yoksay */
  }
}

export function forgetSession(key: string): void {
  const f = sessionFile(key);
  if (f) fs.rmSync(f, { force: true });
}

const transcript = (cwd: string, id: string) => path.join(projectDir(cwd), `${id}.jsonl`);

/** Bu klasördeki oturumlar, en son değişen önce. */
function recentSessions(cwd: string): string[] {
  const dir = projectDir(cwd);
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl') && UUID.test(f.slice(0, -6)))
      .map((f) => ({ id: f.slice(0, -6), t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .map((x) => x.id);
  } catch {
    return [];
  }
}

/**
 * Açılışta her pane için sürdürülecek oturum kimliğini bulur (yoksa null → yeni oturum).
 * İki pane asla aynı oturumu almaz. Anahtarı listede olmayan eski kayıtlar silinir.
 */
export function resolveSessions(panes: PaneRef[], keepKeys: string[] = []): (string | null)[] {
  const taken = new Set<string>();
  const result = panes.map((p) => {
    const id = readSession(p.key);
    if (!id || taken.has(id) || !fs.existsSync(transcript(p.cwd, id))) return null;
    taken.add(id);
    return id;
  });

  // Kayıtlı kimliği olmayan pane'ler (ör. önceki sürümden kalanlar): o klasörün henüz
  // başka pane'e verilmemiş en son oturumlarını sırayla dağıt.
  panes.forEach((p, i) => {
    if (result[i] || readSession(p.key)) return;
    const id = recentSessions(p.cwd).find((s) => !taken.has(s));
    if (!id) return;
    taken.add(id);
    result[i] = id;
  });

  const keep = new Set([...panes.map((p) => p.key), ...keepKeys]);
  try {
    for (const f of fs.readdirSync(sessionsDir())) if (!keep.has(f)) fs.rmSync(path.join(sessionsDir(), f), { force: true });
  } catch {
    /* yoksay */
  }
  return result;
}

/** Kapatılmış bir pane'i geri açarken: kayıtlı oturumu hâlâ duruyorsa kimliği. */
export function sessionFor(p: PaneRef): string | null {
  const id = readSession(p.key);
  return id && fs.existsSync(transcript(p.cwd, id)) ? id : null;
}

export const newSessionId = () => randomUUID();
export const isSessionId = (s: unknown): s is string => typeof s === 'string' && UUID.test(s);

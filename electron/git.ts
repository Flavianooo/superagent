import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GitInfo {
  /** Deponun (ya da worktree'nin) kök klasörü. */
  root: string;
  /** Tüm worktree'lerin paylaştığı .git klasörü: aynı depoyu açan pane'leri bulmak için. */
  common: string;
  branch: string;
  changes: number;
}

function git(cwd: string, args: string[], timeout = 4000): Promise<string> {
  return new Promise((resolve, reject) =>
    // --no-optional-locks: durum sorgusu, aynı anda çalışan claude'un git komutlarıyla kilit çakışması yaratmasın.
    execFile('git', ['--no-optional-locks', ...args], { cwd, timeout, windowsHide: true, maxBuffer: 8 << 20 }, (err, out, stderr) =>
      err ? reject(Object.assign(err, { stderr })) : resolve(out),
    ),
  );
}

export async function gitInfo(cwd: string): Promise<GitInfo | null> {
  try {
    const [root, common, branch] = (
      await git(cwd, ['rev-parse', '--show-toplevel', '--path-format=absolute', '--git-common-dir', '--abbrev-ref', 'HEAD'])
    )
      .trim()
      .split(/\r?\n/);
    const status = await git(cwd, ['status', '--porcelain']);
    return {
      root: path.normalize(root),
      common: path.normalize(common),
      branch: branch === 'HEAD' ? 'detached' : branch,
      changes: status.split('\n').filter(Boolean).length,
    };
  } catch {
    return null;
  }
}

/** Deponun yanına `<depo>-<ad>` klasöründe, `superagent/<ad>` dalıyla yeni bir worktree açar. */
export async function addWorktree(root: string, name: string): Promise<{ path: string } | { error: string }> {
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(name)) return { error: 'Ad yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir.' };
  const dir = path.join(path.dirname(root), `${path.basename(root)}-${name}`);
  if (fs.existsSync(dir)) return { error: `${dir} zaten var.` };
  try {
    await git(root, ['worktree', 'add', '-b', `superagent/${name}`, dir], 60000);
    return { path: dir };
  } catch (err) {
    const msg = String((err as { stderr?: string }).stderr || (err as Error).message);
    return { error: msg.trim().split('\n').pop() || 'Worktree oluşturulamadı.' };
  }
}

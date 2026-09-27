export type Status = 'starting' | 'working' | 'waiting' | 'idle' | 'exited';

export const STATUS_LABEL: Record<Status, string> = {
  starting: 'başlıyor',
  working: 'çalışıyor',
  waiting: 'onay bekliyor',
  idle: 'hazır',
  exited: 'kapandı',
};

// Claude Code çalışırken durum satırında "esc to interrupt" gösterir ve terminal başlığının
// başına dönen bir spinner karakteri koyar; boştayken başlıkta "✳" durur.
const WORKING_TEXT = /esc to interrupt|ctrl\+c to interrupt/i;
const WAITING_TEXT = /Do you want to|Would you like to|❯\s*1\.\s*Yes|\(y\/n\)|Press Enter to continue|Enter to confirm/i;
const SPINNER_TITLE = /^[⠀-⣿·✢✶✻✽✺*]/;

// Claude kapanıp kabuğa dönüldüyse (PowerShell "PS C:\...>" ya da cmd "C:\...>") ekranda kalan eski metin yok sayılır.
const SHELL_PROMPT = /^(PS [A-Za-z]:\\.*>|[A-Za-z]:\\[^>]*>)/;

export function detect(screen: string, title: string): Exclude<Status, 'exited' | 'starting'> {
  const lines = screen.split('\n').filter((l) => l.trim());
  // Sürükle-bırakla yapıştırılan uzun yollar prompt satırını sarar; son birkaç satıra bak.
  if (lines.slice(-4).some((l) => SHELL_PROMPT.test(l)) && !/esc to interrupt/i.test(lines.slice(-4).join('\n'))) return 'idle';
  if (WAITING_TEXT.test(screen)) return 'waiting';
  if (WORKING_TEXT.test(screen) || SPINNER_TITLE.test(title.trim())) return 'working';
  return 'idle';
}

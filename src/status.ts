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

/** Claude kapanmış, kabuk istemine dönülmüş mü? */
export function atShellPrompt(screen: string): boolean {
  const last = screen.split('\n').filter((l) => l.trim()).slice(-4);
  // Sürükle-bırakla yapıştırılan uzun yollar prompt satırını sarar; son birkaç satıra bak.
  return last.some((l) => SHELL_PROMPT.test(l)) && !/esc to interrupt/i.test(last.join('\n'));
}

export function detect(screen: string, title: string): Exclude<Status, 'exited' | 'starting'> {
  if (atShellPrompt(screen)) return 'idle';
  if (WAITING_TEXT.test(screen)) return 'waiting';
  if (WORKING_TEXT.test(screen) || SPINNER_TITLE.test(title.trim())) return 'working';
  return 'idle';
}

/** Claude hook olayından durum; durumu değiştirmeyen olaylar için null. */
export function hookStatus(event: string, notificationType?: string, toolName?: string): Status | null {
  switch (event) {
    case 'UserPromptSubmit':
    case 'PostToolUse':
      return 'working';
    case 'PreToolUse':
      // Soru aracı kullanıcıdan cevap bekler.
      return toolName === 'AskUserQuestion' ? 'waiting' : 'working';
    case 'PermissionRequest':
      return 'waiting';
    case 'Notification':
      if (notificationType === 'permission_prompt' || notificationType === 'elicitation_dialog') return 'waiting';
      if (notificationType === 'idle_prompt') return 'idle';
      return null;
    case 'Stop':
      return 'idle';
    default:
      return null;
  }
}

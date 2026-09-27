# SuperAgent

A minimal, dark-themed Windows app that runs Claude Code terminals in a **1 / 2 / 3 / 4 / 6 / 8 pane grid** inside a single window. Every pane is a real terminal (PowerShell + `claude`), and you can follow the progress of all sessions from one screen.

## Download

Grab **[SuperAgent.exe](https://github.com/Flavianooo/superagent/releases/latest/download/SuperAgent.exe)** from the [latest release](https://github.com/Flavianooo/superagent/releases/latest) and double-click it — it's portable, no installation needed.

Requires Windows 10/11 and the `claude` command on your PATH ([Claude Code](https://code.claude.com)).

> The exe is unsigned, so Windows SmartScreen may show an "unknown publisher" warning on first launch: click **More info → Run anyway**.

## Features

- **Grid layouts:** single, 2 side by side, 2 stacked, 3 (1 large + 2), 2×2, 3×2, 4×2
- **Status tracking:** each pane shows 🟢 working · 🟠 waiting for approval · ⚪ ready · 🔴 exited, with a summary in the top bar
- **Notifications:** when the window is in the background, you get a Windows notification and a taskbar flash as soon as a session finishes or asks for approval
- **Session restore:** your layout and terminals come back on next launch, resumed with `claude --continue`
- **Settings:** shell (PowerShell / pwsh / cmd), auto-start `claude`, extra `claude` arguments, font size

## Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+T` | New terminal |
| `Ctrl+Shift+W` | Close pane |
| `Ctrl+1…8` | Focus pane |
| `Ctrl+Shift+Enter` / double-click header | Maximize / back to grid |
| `Ctrl+=` / `Ctrl+-` | Font size |
| Double-click name | Rename pane |
| `Ctrl+C` with a selection | Copy (without a selection it interrupts Claude) |
| `Ctrl+V` / right-click | Paste |

## Build from source

Requirements: Windows 10/11, Node.js 20+, [Claude Code](https://code.claude.com) (`claude` on your PATH).

```bash
npm install
npm start          # build and run
npm run dist       # produce release/SuperAgent.exe (portable)
```

## Tech stack

Electron · xterm.js (WebGL) · `@lydell/node-pty` (ConPTY, prebuilt) · TypeScript · esbuild

```
electron/   main process, PTY manager, preload bridge
src/        UI: grid, panes, status detection, styles
```

Status detection looks at Claude Code's on-screen text ("esc to interrupt", "Do you want to…") and the terminal title; the patterns live in `src/status.ts`.

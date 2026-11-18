# SuperAgent

A minimal, dark-themed Windows app that runs Claude Code terminals in a **1 / 2 / 3 / 4 / 6 / 8 pane grid** inside a single window. Every pane is a real terminal (PowerShell + `claude`), and you can follow the progress of all sessions from one screen.

## Download

Grab **[SuperAgent-Setup.exe](https://github.com/Flavianooo/superagent/releases/latest/download/SuperAgent-Setup.exe)** from the [latest release](https://github.com/Flavianooo/superagent/releases/latest) and run it. It installs per user (no admin rights) and adds Start menu and desktop shortcuts; pin the running app to the taskbar from there.

Requires Windows 10/11 and the `claude` command on your PATH ([Claude Code](https://code.claude.com)).

> The exe is unsigned, so Windows SmartScreen may show an "unknown publisher" warning on first launch: click **More info → Run anyway**.

## Features

- **Grid layouts:** single, 2 side by side, 2 stacked, 3 (1 large + 2), 2×2, 3×2, 4×2
- **Status tracking:** each pane shows 🟢 working · 🟠 waiting for approval · ⚪ ready · 🔴 exited, reported by Claude Code hooks (with on-screen detection as a fallback). Click a summary chip in the top bar to jump to the next pane in that state
- **Notifications:** when the window is in the background, you get a Windows notification and a taskbar flash as soon as a session finishes or asks for approval; clicking the notification focuses that pane
- **Session restore:** your layout and terminals come back on next launch, and every pane resumes its own Claude session (tracked per pane, never shared)
- **Reopen closed panes:** a closed pane can be reopened with its session from the New menu or `Ctrl+Shift+Z`
- **Git at a glance:** each pane header shows the branch and the number of uncommitted changes
- **Worktrees:** opening a repo that another pane already uses offers a separate git worktree (`<repo>-<name>`, branch `superagent/<name>`) so two Claudes don't overwrite each other
- **Workspaces:** save the open panes and layout under a name and reopen them in one click
- **Search all panes:** `Ctrl+Shift+F` searches every pane's scrollback and jumps to the match
- **Settings:** shell (PowerShell / pwsh / cmd), auto-start `claude`, extra `claude` arguments, font size

## Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+T` | New terminal |
| `Ctrl+Shift+W` | Close pane |
| `Ctrl+Shift+Z` | Reopen last closed pane |
| `Ctrl+Shift+Space` | Next pane waiting for approval |
| `Ctrl+Shift+F` | Search all panes |
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
npm run dist       # produce release/SuperAgent-Setup.exe (installer)
npm run dist:portable   # portable release/SuperAgent.exe
```

## Tech stack

Electron · xterm.js (WebGL) · `@lydell/node-pty` (ConPTY, prebuilt) · TypeScript · esbuild

```
electron/   main process, PTY manager, preload bridge
src/        UI: grid, panes, status detection, styles
```

Each pane's `claude` is started with `--settings` pointing at a generated file in the app's data folder. Its HTTP hooks send status events (prompt submitted, tool use, permission request, stop) to a local server in the main process, and a SessionStart hook records the pane's session id so it can be resumed with `--resume`. If no hook event arrives, status falls back to Claude Code's on-screen text and terminal title (`src/status.ts`).

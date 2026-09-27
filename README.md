# SuperAgent

Claude Code terminallerini tek pencerede **1 / 2 / 3 / 4 / 6 / 8'li grid** halinde çalıştıran, sade ve koyu temalı Windows uygulaması. Her pane gerçek bir terminaldir (PowerShell + `claude`); tüm session'ların durumunu aynı ekrandan takip edersin.

## Özellikler

- **Grid düzenleri:** tek, 2 yan yana, 2 alt alta, 3 (1 büyük + 2), 2×2, 3×2, 4×2
- **Durum takibi:** her pane'de 🟢 çalışıyor · 🟠 onay bekliyor · ⚪ hazır · 🔴 kapandı; üst barda toplam özet
- **Bildirim:** pencere arka plandayken bir session bittiğinde veya onay istediğinde Windows bildirimi + taskbar flash
- **Oturum hatırlama:** düzen ve terminaller bir sonraki açılışta `claude --continue` ile geri gelir
- **Ayarlar:** kabuk (PowerShell / pwsh / cmd), `claude` otomatik başlatma, ek argümanlar, yazı boyutu

## Kısayollar

| Kısayol | İşlev |
|---|---|
| `Ctrl+Shift+T` | Yeni terminal |
| `Ctrl+Shift+W` | Pane'i kapat |
| `Ctrl+1…8` | Pane seç |
| `Ctrl+Shift+Enter` / başlığa çift tık | Büyüt / grid'e dön |
| `Ctrl+=` / `Ctrl+-` | Yazı boyutu |
| İsme çift tık | Yeniden adlandır |
| Seçim varken `Ctrl+C` | Kopyala (seçim yoksa Claude'a kesme) |
| `Ctrl+V` / sağ tık | Yapıştır |

## Kurulum

Gereksinimler: Windows 10/11, Node.js 20+, [Claude Code](https://code.claude.com) (`claude` komutu PATH'te).

```bash
npm install
npm start          # derle ve çalıştır
npm run dist       # release/SuperAgent.exe (portable) üret
```

## Teknoloji

Electron · xterm.js (WebGL) · `@lydell/node-pty` (ConPTY, prebuilt) · TypeScript · esbuild

```
electron/   main süreç, PTY yöneticisi, preload köprüsü
src/        arayüz: grid, pane, durum tespiti, stiller
```

Durum tespiti Claude Code'un ekran metnine ("esc to interrupt", "Do you want to…") ve terminal başlığına bakar; kalıplar `src/status.ts` içindedir.

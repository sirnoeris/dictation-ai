# 🎙 Dictation AI

> AI-powered voice dictation for macOS. Hold a key, speak, and your words appear at the cursor — cleaned up and ready to use.

Powered by [Groq Whisper](https://console.groq.com) for fast transcription and [xAI Grok](https://console.x.ai) for intelligent text cleanup. Runs as a lightweight menu bar app with no Dock icon.

**Cost:** ~$0.20/month at heavy usage (free on Groq's free tier for light use).

---

## Features

- **Hold-to-talk or toggle mode** — hold a key while speaking, release to transcribe
- **Live transcript preview** — see text appear as you speak
- **AI cleanup** — Grok removes filler words, fixes punctuation, formats text
- **Auto-paste** — text lands at your cursor automatically
- **Draggable pill UI** — move the floating overlay anywhere on screen, position is remembered
- **Sound cues** — subtle audio feedback on start, stop, and paste
- **Any hold key** — configure any key including Fn/Globe, Right ⌘, F13–F15
- **macOS menu bar app** — no Dock icon, always available

---

## Quick Start

```bash
git clone https://github.com/sirnoeris/dictation-ai.git
cd dictation-ai
bash setup.sh
npm start
```

Settings opens automatically on first launch.

---

## API Keys

You need **at minimum one transcription key**. The xAI key is optional but recommended for smart cleanup.

| Service | Used for | Cost | Get key |
|---------|----------|------|---------|
| [Groq](https://console.groq.com) | Speech → text (Whisper large-v3-turbo) | Free tier, then ~$0.0005/min | Free signup |
| [OpenAI](https://platform.openai.com) | Speech → text (Whisper), alternative | ~$0.006/min | Pay-as-you-go |
| [xAI](https://console.x.ai) | Text cleanup via Grok | Per token (very cheap) | Account required |

Enter keys in **Settings** — click the mic icon in menu bar, or the ⚙ gear in the floating pill.

---

## Permissions

macOS requires two one-time permissions:

**Microphone** — prompted automatically on first recording.

**Accessibility** (for auto-paste) — open this panel and add Electron:
```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

---

## Hotkey Setup

### Toggle mode (default)
Press your hotkey once to start, once to stop. Configure any [Electron accelerator](https://www.electronjs.org/docs/latest/api/accelerator) — e.g. `F13`, `Ctrl+Option+Space`.

### Hold-to-talk mode
1. Settings → Recording Mode → **Hold to talk**
2. Click **Press a Key…** and press the key you want to hold
3. Save Settings

**To use the Fn/Globe key:** first go to  
**System Settings → Keyboard → Press Globe key to → Do Nothing**  
then capture it via the "Press a Key…" button.

---

## Build a distributable .dmg

```bash
bash assets/make-icns.sh   # one-time: generate icon.icns
npm run build              # outputs universal arm64+x64 .dmg to /dist
```

Open the `.dmg`, drag to `/Applications`. Right-click → Open if macOS blocks it.  
Add to **System Settings → General → Login Items** to auto-start.

---

## Architecture

```
main.js               Electron main — tray, hotkeys, IPC, paste
preload.js            Context bridge (renderer ↔ main)
src/recorder.html+js  Floating pill UI + Web Audio capture
src/settings.html+js  Settings window
services/
  transcribe.js       Groq / OpenAI Whisper API
  enhance.js          xAI Grok text cleanup
assets/               App icons + tray icons
```

**Recording pipeline:**
1. `webkitSpeechRecognition` → live text preview as you speak (on-device)
2. `MediaRecorder` → captures full audio for Whisper (higher accuracy final result)
3. Whisper API → transcription
4. Grok API → cleanup (skipped for ≤5 words, saving ~500ms)
5. Clipboard + AppleScript → paste at cursor

---

## Windows Support (future)

The only macOS-specific code is in `main.js → pasteText()`. Replace the `osascript` call with:

```js
// Windows
exec('powershell -command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')"')
```

---

## Cost Estimate

| Usage | Groq Whisper | xAI Grok cleanup | Total |
|-------|-------------|-----------------|-------|
| Light (5 min/day) | ~$0.00 (free tier) | ~$0.01 | ~$0.01/mo |
| Heavy (30 min/day) | ~$0.05 | ~$0.15 | ~$0.20/mo |

---

## License

MIT

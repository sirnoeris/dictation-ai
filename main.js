'use strict';

// ── Global crash guard ────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  // Don't quit — log and keep running
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const {
  app, BrowserWindow, Tray, Menu, globalShortcut,
  ipcMain, clipboard, nativeImage, shell, screen,
  systemPreferences, dialog
} = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');

// ── Services ─────────────────────────────────────────────────────────────────
const { transcribeAudio } = require('./services/transcribe');
const { enhanceText }     = require('./services/enhance');

// ── Settings ──────────────────────────────────────────────────────────────────
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

const DEFAULT_SETTINGS = {
  transcriptionProvider : 'groq',
  openaiApiKey          : '',
  groqApiKey            : '',
  xaiApiKey             : '',
  xaiModel              : 'grok-3-mini',
  enhancementEnabled    : true,
  enhancementPrompt     : 'You are a dictation cleanup assistant. Fix punctuation and capitalisation. Remove filler words (um, uh, like). Return only the cleaned text — no explanation.',
  hotkey                : 'Ctrl+Option+Space',
  language              : '',
  autoPaste             : true,
  recordingMode         : 'toggle',   // 'toggle' | 'hold'
  holdKeyCode           : null,       // raw uiohook keycode for hold-to-talk
  holdKeyLabel          : '',
  pillX                 : null,  // saved pill X position (null = auto)
  pillY                 : null,  // saved pill Y position (null = auto)
};

let settings = { ...DEFAULT_SETTINGS };

function loadSettings () {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) };
    }
  } catch (e) { console.error('loadSettings:', e.message); }
}

function persistSettings (patch) {
  settings = { ...settings, ...patch };
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
  } catch (e) { console.error('persistSettings:', e.message); }
}

// ── State ─────────────────────────────────────────────────────────────────────
let tray            = null;
let recorderWin     = null;
let settingsWin     = null;
let isRecording     = false;
let isProcessing    = false;
let prevFrontApp    = null;
let holdActive      = false;   // true while the hold key is physically pressed
let isLearningKey   = false;   // true during "press a key to set hold key" mode
let uiohookRunning  = false;

// ── uiohook (lazy-loaded for hold-to-talk) ────────────────────────────────────
let _uiohook = null;
function getHook () {
  if (!_uiohook) {
    try { _uiohook = require('uiohook-napi'); }
    catch (e) { console.warn('uiohook-napi unavailable:', e.message); }
  }
  return _uiohook;
}

function startHookListeners () {
  const u = getHook();
  if (!u) return;

  u.uIOhook.removeAllListeners('keydown');
  u.uIOhook.removeAllListeners('keyup');

  u.uIOhook.on('keydown', (e) => {
    // ── Key-learning mode: next key press becomes the hold key ──
    if (isLearningKey) {
      isLearningKey = false;
      const keyCode = e.keycode;
      const label   = keyCodeToLabel(e);
      persistSettings({ holdKeyCode: keyCode, holdKeyLabel: label });
      if (settingsWin) settingsWin.webContents.send('key-learned', { keyCode, label });
      // Re-arm listeners with new keycode
      startHookListeners();
      return;
    }

    // ── Hold-to-talk: start recording on key-down ──
    if (
      settings.recordingMode === 'hold' &&
      settings.holdKeyCode !== null &&
      e.keycode === settings.holdKeyCode &&
      !holdActive && !isProcessing
    ) {
      holdActive = true;
      startRecording();
    }
  });

  u.uIOhook.on('keyup', (e) => {
    if (
      settings.recordingMode === 'hold' &&
      settings.holdKeyCode !== null &&
      e.keycode === settings.holdKeyCode &&
      holdActive
    ) {
      holdActive = false;
      if (isRecording) stopRecording();
    }
  });

  if (!uiohookRunning) {
    try {
      u.uIOhook.start();
      uiohookRunning = true;
    } catch (e) {
      console.error('uiohook start failed:', e.message);
    }
  }
}

function stopHookListeners () {
  const u = getHook();
  if (u && uiohookRunning) {
    u.uIOhook.removeAllListeners('keydown');
    u.uIOhook.removeAllListeners('keyup');
    u.uIOhook.stop();
    uiohookRunning = false;
  }
  holdActive = false;
}

// Convert a uiohook event to a readable label for the Settings UI
function keyCodeToLabel (e) {
  const names = {
    63  : 'Fn / Globe',
    54  : 'Right ⌘ Command',
    61  : 'Right ⌥ Option',
    57  : 'Caps Lock',
  };
  if (names[e.keycode]) return names[e.keycode];
  // F-keys: Carbon key codes F1=122...F15=113 (approximate)
  const fKeys = { 122:'F1',120:'F2',99:'F3',118:'F4',96:'F5',97:'F6',98:'F7',100:'F8',101:'F9',109:'F10',103:'F11',111:'F12',105:'F13',107:'F14',113:'F15' };
  if (fKeys[e.keycode]) return fKeys[e.keycode];
  return `Key (code ${e.keycode})`;
}

// ── Tray Icon (PNG files — reliable on all macOS versions) ────────────────────
function makeTrayIcon (recording) {
  const file = recording ? 'tray_rec_16.png' : 'tray_16.png';
  const img  = nativeImage.createFromPath(path.join(__dirname, 'assets', file));
  // Template image: macOS auto-inverts for dark/light menu bar (idle state only)
  if (!recording) img.setTemplateImage(true);
  return img;
}

// ── Tray ──────────────────────────────────────────────────────────────────────
function createTray () {
  tray = new Tray(makeTrayIcon(false));
  tray.setToolTip('Dictation AI — click for menu');
  rebuildTrayMenu();
  // On macOS, setContextMenu IS the click handler — no separate click listener needed.
  // Double-click as a convenience shortcut to Settings.
  tray.on('double-click', () => openSettings());
}

function rebuildTrayMenu () {
  const menu = Menu.buildFromTemplate([
    // Settings at the very top — first thing you see
    { label: '⚙️  Settings…', click: openSettings },
    { type: 'separator' },
    {
      label   : isRecording ? '⏹  Stop Recording' : '🎙  Start Recording',
      enabled : !isProcessing,
      click   : () => toggleRecording()
    },
    { type: 'separator' },
    { label: 'Quit Dictation AI', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ── Recorder Window ───────────────────────────────────────────────────────────
function createRecorderWindow () {
  recorderWin = new BrowserWindow({
    width            : 380,
    height           : 130,
    frame            : false,
    transparent      : true,
    alwaysOnTop      : true,
    skipTaskbar      : true,
    resizable        : false,
    show             : false,
    hasShadow        : true,
    webPreferences   : {
      preload          : path.join(__dirname, 'preload.js'),
      contextIsolation : true,
      nodeIntegration  : false,
    },
  });
  recorderWin.loadFile(path.join(__dirname, 'src', 'recorder.html'));
  positionRecorderWindow();
  // Save position whenever the user drags the pill
  recorderWin.on('moved', () => {
    const [x, y] = recorderWin.getPosition();
    persistSettings({ pillX: x, pillY: y });
  });

  recorderWin.on('closed', () => { recorderWin = null; });
}

function positionRecorderWindow () {
  if (!recorderWin) return;
  const { workAreaSize } = screen.getPrimaryDisplay();
  const x = settings.pillX != null
    ? settings.pillX
    : workAreaSize.width - 400;       // default: bottom-right, 20px from edge
  const y = settings.pillY != null
    ? settings.pillY
    : workAreaSize.height - 160;
  recorderWin.setPosition(
    Math.max(0, Math.min(x, workAreaSize.width  - 380)),
    Math.max(0, Math.min(y, workAreaSize.height - 130))
  );
}

// ── Settings Window ───────────────────────────────────────────────────────────
function openSettings () {
  if (settingsWin) { settingsWin.focus(); return; }

  settingsWin = new BrowserWindow({
    width          : 560,
    height         : 680,
    titleBarStyle  : 'hiddenInset',
    title          : 'Dictation AI — Settings',
    resizable      : false,
    webPreferences : {
      preload          : path.join(__dirname, 'preload.js'),
      contextIsolation : true,
      nodeIntegration  : false,
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'src', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ── Recording Control ─────────────────────────────────────────────────────────
function hasApiKey () {
  return (settings.transcriptionProvider === 'groq' && settings.groqApiKey.trim()) ||
         (settings.transcriptionProvider === 'openai' && settings.openaiApiKey.trim());
}

function startRecording () {
  if (isRecording || isProcessing) return;
  if (!hasApiKey()) {
    openSettings();
    return;
  }

  // Capture the currently-focused app BEFORE we do anything that might steal focus
  exec(
    `osascript -e 'tell application "System Events" to name of first process whose frontmost is true'`,
    (err, stdout) => { if (!err) prevFrontApp = stdout.trim(); }
  );

  isRecording = true;
  tray.setImage(makeTrayIcon(true));
  rebuildTrayMenu();

  if (!recorderWin) createRecorderWindow();
  positionRecorderWindow();
  recorderWin.showInactive();   // show overlay WITHOUT stealing keyboard focus
  recorderWin.webContents.send('cmd:start');
}

function stopRecording () {
  if (!isRecording) return;
  if (!recorderWin) return;
  isRecording = false;
  recorderWin.webContents.send('cmd:stop');
}

function toggleRecording () {
  isRecording ? stopRecording() : startRecording();
}

// ── Hotkey Registration ───────────────────────────────────────────────────────
function registerHotkey () {
  if (settings.recordingMode === 'hold') {
    // Hold-to-talk: use uiohook for key-down/key-up; no globalShortcut needed
    globalShortcut.unregisterAll();
    startHookListeners();
  } else {
    // Toggle mode: use Electron globalShortcut; stop uiohook if running
    stopHookListeners();
    globalShortcut.unregisterAll();
    const key = settings.hotkey || DEFAULT_SETTINGS.hotkey;
    const ok  = globalShortcut.register(key, () => toggleRecording());
    if (!ok) {
      console.warn(`Could not register hotkey "${key}", falling back to Ctrl+Shift+D`);
      globalShortcut.register('Ctrl+Shift+D', () => toggleRecording());
    }
  }
}

// ── IPC: Audio pipeline ───────────────────────────────────────────────────────
ipcMain.handle('audio:ready', async (_event, audioData, mimeType) => {
  try {
    isRecording  = false;
    isProcessing = true;
    tray.setImage(makeTrayIcon(false));
    rebuildTrayMenu();

    if (recorderWin) recorderWin.webContents.send('status:processing');

    // Pass audio buffer directly to Whisper — no temp file needed
    let text = await transcribeAudio(Buffer.from(audioData), mimeType || 'audio/webm', settings);

    if (!text?.trim()) {
      if (recorderWin) recorderWin.webContents.send('status:done', '(nothing detected)');
      finishProcessing();
      return { ok: true, text: '' };
    }

    text = text.trim();

    // Enhance with xAI Grok — skip for short text (≤5 words) to save ~500-800ms
    const wordCount = text.trim().split(/\s+/).length;
    if (settings.enhancementEnabled && settings.xaiApiKey?.trim() && wordCount > 5) {
      try { text = await enhanceText(text, settings); }
      catch (e) { console.warn('Enhancement failed, using raw text:', e.message); }
    }

    if (recorderWin) recorderWin.webContents.send('status:done', text);

    // Paste
    if (settings.autoPaste) await pasteText(text);

    finishProcessing();
    return { ok: true, text };

  } catch (err) {
    console.error('audio:ready error:', err.message);
    if (recorderWin) recorderWin.webContents.send('status:error', err.message);
    finishProcessing();
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('open-settings', () => openSettings());

ipcMain.handle('pill:save-position', (_e, x, y) => {
  persistSettings({ pillX: x, pillY: y });
});

ipcMain.handle('audio:cancel', () => {
  isRecording  = false;
  isProcessing = false;
  tray.setImage(makeTrayIcon(false));
  rebuildTrayMenu();
});

// ── IPC: Settings ─────────────────────────────────────────────────────────────
ipcMain.handle('settings:get', () => settings);

ipcMain.handle('settings:save', (_event, patch) => {
  persistSettings(patch);
  // Re-arm hotkey whenever mode, hotkey string, or holdKeyCode changes
  if (patch.hotkey || patch.recordingMode || patch.holdKeyCode !== undefined) {
    registerHotkey();
  }
  return { ok: true };
});

// Start/cancel the "press a key to learn" flow
ipcMain.handle('hotkey:learn:start', () => {
  isLearningKey = true;
  startHookListeners();   // ensure hook is running even in toggle mode
  return { ok: true };
});

ipcMain.handle('hotkey:learn:cancel', () => {
  isLearningKey = false;
  // If we're still in toggle mode, stop the hook again
  if (settings.recordingMode !== 'hold') stopHookListeners();
  return { ok: true };
});

// ── Accessibility check ───────────────────────────────────────────────────────
function checkAccessibility () {
  if (process.platform !== 'darwin') return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

function requestAccessibility () {
  if (process.platform !== 'darwin') return;
  // Passing true prompts macOS to open System Preferences if not already trusted
  const trusted = systemPreferences.isTrustedAccessibilityClient(true);
  if (!trusted) {
    dialog.showMessageBox({
      type    : 'info',
      title   : 'Accessibility Permission Required',
      message : 'Enable auto-paste for Dictation AI',
      detail  :
        'To paste text at your cursor automatically, you need to grant Accessibility access.\n\n'
        + '1. Open System Settings → Privacy & Security → Accessibility\n'
        + '2. Click + and add Electron (dev) or Dictation AI (.app)\n'
        + '3. Toggle it ON\n\n'
        + 'Your text has been copied to the clipboard in the meantime — press Cmd+V to paste.',
      buttons : ['Open System Settings', 'OK'],
    }).then(({ response }) => {
      if (response === 0) {
        exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"');
      }
    });
  }
}

// ── Text Paste ────────────────────────────────────────────────────────────────
async function pasteText (text) {
  const prev = clipboard.readText();
  clipboard.writeText(text);
  await delay(30);

  if (!checkAccessibility()) {
    requestAccessibility();
    if (recorderWin) recorderWin.webContents.send('status:clipboard', text);
    return;
  }

  // Re-activate the app that was focused when the user started dictating
  if (prevFrontApp) {
    await new Promise(resolve => {
      exec(
        `osascript -e 'tell application "${prevFrontApp}" to activate'`,
        () => resolve()
      );
    });
    await delay(80);    // give the app time to come to front
  }

  // Now simulate Cmd+V into the restored app
  await new Promise(resolve => {
    exec(
      `osascript -e 'tell application "System Events" to keystroke "v" using {command down}'`,
      (err) => {
        if (err) {
          console.warn('AppleScript paste failed:', err.message);
          requestAccessibility();
          if (recorderWin) recorderWin.webContents.send('status:clipboard', text);
        }
        resolve();
      }
    );
  });

  // Restore previous clipboard after 3 s
  setTimeout(() => clipboard.writeText(prev), 3000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function delay (ms) { return new Promise(r => setTimeout(r, ms)); }

function finishProcessing () {
  isProcessing = false;
  rebuildTrayMenu();
  // Auto-hide recorder window after 2.5 s
  setTimeout(() => { if (recorderWin) recorderWin.hide(); }, 2500);
}

// ── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  app.setActivationPolicy('accessory'); // No Dock icon — menu bar only

  loadSettings();
  createTray();
  createRecorderWindow();
  registerHotkey();

  // First-launch: open settings if no API keys
  const noKeys = !settings.groqApiKey && !settings.openaiApiKey;
  if (noKeys) setTimeout(openSettings, 800);

  // Proactively request Accessibility if auto-paste is on
  if (settings.autoPaste && !checkAccessibility()) {
    setTimeout(requestAccessibility, 1500);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopHookListeners();
});

// Single-instance lock
if (!app.requestSingleInstanceLock()) app.quit();

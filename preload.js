'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('DA', {
  // ── Settings ────────────────────────────────────────────────
  getSettings  : ()       => ipcRenderer.invoke('settings:get'),
  saveSettings : (patch)  => ipcRenderer.invoke('settings:save', patch),

  // ── Audio pipeline ───────────────────────────────────────────
  sendAudio    : (buf, mime) => ipcRenderer.invoke('audio:ready', buf, mime),
  cancelAudio  : ()          => ipcRenderer.invoke('audio:cancel'),
  openSettings    : ()       => ipcRenderer.invoke('open-settings'),
  savePillPosition : (x, y) => ipcRenderer.invoke('pill:save-position', x, y),

  // ── Hold-to-talk key learning ────────────────────────────────
  startKeyLearn  : () => ipcRenderer.invoke('hotkey:learn:start'),
  cancelKeyLearn : () => ipcRenderer.invoke('hotkey:learn:cancel'),

  // ── Events: main → renderer ──────────────────────────────────
  on (channel, cb) {
    const allowed = [
      'cmd:start', 'cmd:stop',
      'status:processing', 'status:done', 'status:error', 'status:clipboard',
      'key-learned',
    ];
    if (!allowed.includes(channel)) return;
    const handler = (_e, ...args) => cb(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});

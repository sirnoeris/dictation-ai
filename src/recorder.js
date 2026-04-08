'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const label    = document.getElementById('label');
const preview  = document.getElementById('preview');
const waveEl   = document.getElementById('wave');
const waveCtx  = waveEl.getContext('2d');

// ── Audio state ───────────────────────────────────────────────────────────────
let mediaRec     = null;
let chunks       = [];
let audioCtx     = null;
let analyser     = null;
let rafId        = null;
let stream       = null;
let recognition  = null;
let interimFinal = '';

// ── Sound cues (Web Audio API — no files needed) ──────────────────────────────
function playTone (freqs, durs, vol = 0.11) {
  try {
    const ctx = new AudioContext();
    freqs.forEach((freq, i) => {
      const t    = ctx.currentTime + durs.slice(0, i).reduce((a, b) => a + b, 0);
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + durs[i]);
      osc.start(t);
      osc.stop(t + durs[i] + 0.02);
    });
  } catch (_) {}
}

const sounds = {
  start : () => playTone([880],       [0.07]),               // short high blip
  stop  : () => playTone([440],       [0.09]),               // lower blip
  done  : () => playTone([523, 659],  [0.09, 0.14]),         // two-note chime ✓
  error : () => playTone([220, 180],  [0.09, 0.18], 0.07),  // low buzz
};

// ── State machine ─────────────────────────────────────────────────────────────
function setState (s, text = '') {
  document.querySelectorAll('.icon-state').forEach(el => el.classList.remove('active'));
  document.getElementById(`icon-${s}`)?.classList.add('active');

  waveEl.style.display = s === 'recording' ? 'block' : 'none';
  document.body.classList.toggle('recording', s === 'recording');

  switch (s) {
    case 'idle':
      label.textContent   = 'Ready — press hotkey to dictate';
      preview.textContent = '';
      break;
    case 'recording':
      label.textContent   = 'Listening…';
      preview.textContent = '';
      break;
    case 'processing':
      label.textContent   = 'Transcribing…';
      preview.textContent = '';
      break;
    case 'done':
      label.textContent   = text ? '✓ Pasted' : '(nothing detected)';
      preview.textContent = truncate(text, 55);
      sounds.done();
      break;
    case 'clipboard':
      label.textContent   = '📋 Copied — press Cmd+V to paste';
      preview.textContent = truncate(text, 55);
      sounds.done();
      break;
    case 'error':
      label.textContent   = 'Error';
      preview.textContent = truncate(text, 55);
      sounds.error();
      break;
  }
}

function truncate (s, n) {
  return s && s.length > n ? s.slice(0, n) + '…' : (s || '');
}

// ── Waveform ──────────────────────────────────────────────────────────────────
function drawWave () {
  if (!analyser) return;
  rafId = requestAnimationFrame(drawWave);

  const buf = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(buf);

  waveCtx.clearRect(0, 0, waveEl.width, waveEl.height);
  waveCtx.lineWidth   = 2;
  waveCtx.strokeStyle = '#ff6b6b';
  waveCtx.beginPath();

  const sliceW = waveEl.width / buf.length;
  let x = 0;
  for (let i = 0; i < buf.length; i++) {
    const y = (buf[i] / 128) * (waveEl.height / 2);
    i === 0 ? waveCtx.moveTo(x, y) : waveCtx.lineTo(x, y);
    x += sliceW;
  }
  waveCtx.lineTo(waveEl.width, waveEl.height / 2);
  waveCtx.stroke();
}

// ── Recording ─────────────────────────────────────────────────────────────────
async function startRecording () {
  chunks       = [];
  interimFinal = '';
  setState('recording');
  sounds.start();

  try {
    stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    drawWave();

    // MediaRecorder: full audio for Whisper
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';

    mediaRec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    mediaRec.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
    mediaRec.onstop = () => onRecordingStopped(mediaRec.mimeType || 'audio/webm');
    mediaRec.start(100);

    // webkitSpeechRecognition: real-time display
    startLiveDisplay();

  } catch (err) {
    setState('error', 'Microphone access denied');
    console.error('startRecording:', err);
  }
}

function startLiveDisplay () {
  const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
  if (!SR) return;

  try {
    recognition = new SR();
    recognition.continuous     = true;
    recognition.interimResults = true;

    recognition.onresult = (e) => {
      let interimChunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) interimFinal += t + ' ';
        else                       interimChunk  = t;
      }
      const liveText = (interimFinal + interimChunk).trim();
      if (liveText) {
        // Always visible during recording — bright white
        preview.style.color = '#e8e8e8';
        preview.textContent = truncate(liveText, 160);
      }
    };

    recognition.onerror = (e) => {
      // not-allowed = mic blocked; no-speech = silence; both are fine to swallow
      if (e.error !== 'not-allowed') return;
      console.warn('SpeechRecognition error:', e.error);
    };

    recognition.start();
  } catch (e) {
    console.warn('webkitSpeechRecognition failed to start:', e.message);
  }
}

function stopRecording () {
  sounds.stop();
  if (recognition) { try { recognition.stop(); } catch (_) {} recognition = null; }
  if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();
  cleanupAudio();
}

function cancelRecording () {
  if (recognition) { try { recognition.stop(); } catch (_) {} recognition = null; }
  cleanupAudio();
  setState('idle');
  window.DA.cancelAudio();
}

function cleanupAudio () {
  try { stream?.getTracks().forEach(t => t.stop()); } catch (_) {}
  cancelAnimationFrame(rafId);
  try { audioCtx?.close(); } catch (_) {}
  audioCtx = null;
  analyser = null;
  stream   = null;
}

async function onRecordingStopped (mimeType) {
  // Reset preview colour for result text
  preview.style.color = '';

  if (!chunks.length) {
    setState('error', 'No audio captured');
    return;
  }
  const blob     = new Blob(chunks, { type: mimeType });
  const arrayBuf = await blob.arrayBuffer();
  await window.DA.sendAudio(arrayBuf, mimeType);
}

// ── Drag to reposition ────────────────────────────────────────────────────────
// The pill has -webkit-app-region:drag in CSS; save position after drag ends
let dragSaveTimer = null;
window.addEventListener('mouseup', () => {
  clearTimeout(dragSaveTimer);
  dragSaveTimer = setTimeout(async () => {
    // getCurrentPosition isn't available in renderer — use screen offset heuristic
    // Main process handles position; we just request a save on mouse-up after drag
    if (window.DA.savePillPosition) {
      // We can't read window position from renderer, so signal main to save it
      // main.js persists position on the 'moved' window event instead
    }
  }, 300);
});

// ── Main-process events ───────────────────────────────────────────────────────
window.DA.on('cmd:start',         () => startRecording());
window.DA.on('cmd:stop',          () => stopRecording());
window.DA.on('status:processing', () => setState('processing'));
window.DA.on('status:done',       text => setState('done', text));
window.DA.on('status:error',      msg  => setState('error', msg));
window.DA.on('status:clipboard',  text => setState('clipboard', text));

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') cancelRecording();
});

'use strict';

// ── Load settings on page ready ───────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const s = await window.DA.getSettings();

  field('transcriptionProvider').value = s.transcriptionProvider || 'groq';
  field('groqApiKey').value             = s.groqApiKey   || '';
  field('openaiApiKey').value           = s.openaiApiKey || '';
  field('xaiApiKey').value              = s.xaiApiKey    || '';
  field('xaiModel').value               = s.xaiModel     || 'grok-3-mini';
  field('enhancementEnabled').checked   = !!s.enhancementEnabled;
  field('enhancementPrompt').value      = s.enhancementPrompt || '';
  field('hotkey').value                 = s.hotkey       || 'Ctrl+Option+Space';
  field('autoPaste').checked            = s.autoPaste !== false;
  field('language').value               = s.language     || '';
  field('recordingMode').value          = s.recordingMode || 'toggle';

  // Hold key display
  if (s.holdKeyLabel) {
    field('hold-key-display').textContent = s.holdKeyLabel;
  }

  updateProviderUI();
  onModeChange();

  // Listen for key-learned event from main process
  window.DA.on('key-learned', ({ keyCode, label }) => {
    field('hold-key-display').textContent = label;
    field('btn-learn').style.display        = '';
    field('btn-cancel-learn').style.display = 'none';
    field('learn-hint').textContent = `✓ "${label}" set as hold key. Click Save Settings to confirm.`;
    // Show Fn hint if it's the Fn key
    field('fn-hint').style.display = (keyCode === 63) ? 'block' : 'none';
  });
});

// ── Show/hide Groq vs OpenAI key fields ───────────────────────────────────────
field('transcriptionProvider').addEventListener('change', updateProviderUI);

function updateProviderUI () {
  const prov = field('transcriptionProvider').value;
  document.getElementById('field-groq').style.display   = prov === 'groq'   ? '' : 'none';
  document.getElementById('field-openai').style.display = prov === 'openai' ? '' : 'none';
}

// ── Toggle vs Hold mode UI ────────────────────────────────────────────────────
function onModeChange () {
  const mode = field('recordingMode').value;
  field('field-hotkey').style.display  = mode === 'toggle' ? '' : 'none';
  field('field-holdkey').style.display = mode === 'hold'   ? '' : 'none';
}

// ── Key learning ──────────────────────────────────────────────────────────────
async function startLearn () {
  field('btn-learn').style.display        = 'none';
  field('btn-cancel-learn').style.display = '';
  field('hold-key-display').textContent   = 'Waiting — press any key…';
  field('hold-key-display').style.borderColor = '#5b8dee';
  field('learn-hint').textContent = 'Press the key you want to hold while dictating. Esc to cancel.';
  await window.DA.startKeyLearn();
}

async function cancelLearn () {
  await window.DA.cancelKeyLearn();
  field('btn-learn').style.display        = '';
  field('btn-cancel-learn').style.display = 'none';
  field('hold-key-display').style.borderColor = '';
  field('learn-hint').textContent = 'Click "Press a Key…" then press the key you want to hold while dictating.';
  const s = await window.DA.getSettings();
  field('hold-key-display').textContent = s.holdKeyLabel || 'Not set';
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function saveSettings () {
  const patch = {
    transcriptionProvider : field('transcriptionProvider').value,
    groqApiKey            : field('groqApiKey').value.trim(),
    openaiApiKey          : field('openaiApiKey').value.trim(),
    xaiApiKey             : field('xaiApiKey').value.trim(),
    xaiModel              : field('xaiModel').value,
    enhancementEnabled    : field('enhancementEnabled').checked,
    enhancementPrompt     : field('enhancementPrompt').value.trim(),
    hotkey                : field('hotkey').value.trim() || 'Ctrl+Option+Space',
    autoPaste             : field('autoPaste').checked,
    language              : field('language').value,
    recordingMode         : field('recordingMode').value,
  };

  try {
    await window.DA.saveSettings(patch);
    showStatus('ok', '✓ Saved');
  } catch (e) {
    showStatus('error', 'Save failed: ' + e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function field (id) { return document.getElementById(id); }

function showStatus (type, msg) {
  const el = document.getElementById('save-status');
  el.className  = type;
  el.textContent = msg;
  el.style.display = 'flex';
  setTimeout(() => { el.style.display = 'none'; }, 2500);
}

// Expose to inline onclick handlers
window.saveSettings    = saveSettings;
window.onModeChange    = onModeChange;
window.startLearn      = startLearn;
window.cancelLearn     = cancelLearn;

window.toggleReveal = function (inputId, btn) {
  const el = document.getElementById(inputId);
  const show = el.type === 'password';
  el.type  = show ? 'text' : 'password';
  btn.textContent = show ? 'Hide' : 'Show';
};

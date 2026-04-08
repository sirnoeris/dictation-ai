'use strict';

const OpenAI = require('openai');

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/**
 * Transcribe audio directly from a Buffer (no temp file).
 * @param {Buffer}  audioBuffer - Raw audio bytes
 * @param {string}  mimeType    - e.g. 'audio/webm'
 * @param {object}  settings    - App settings
 * @returns {Promise<string>}
 */
async function transcribeAudio (audioBuffer, mimeType, settings) {
  const { transcriptionProvider, openaiApiKey, groqApiKey, language } = settings;

  let client;
  let model;

  if (transcriptionProvider === 'groq') {
    if (!groqApiKey?.trim()) throw new Error('Groq API key is not configured.');
    client = new OpenAI({ apiKey: groqApiKey.trim(), baseURL: GROQ_BASE_URL });
    model  = 'whisper-large-v3-turbo';
  } else {
    if (!openaiApiKey?.trim()) throw new Error('OpenAI API key is not configured.');
    client = new OpenAI({ apiKey: openaiApiKey.trim() });
    model  = 'whisper-1';
  }

  // Convert buffer directly to a File object — no disk write needed
  const audioFile = await OpenAI.toFile(
    Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer),
    'audio.webm',
    { type: mimeType || 'audio/webm' }
  );

  const params = { file: audioFile, model, response_format: 'text' };
  if (language?.trim()) params.language = language.trim();

  const result = await client.audio.transcriptions.create(params);
  return typeof result === 'string' ? result : (result.text ?? '');
}

module.exports = { transcribeAudio };

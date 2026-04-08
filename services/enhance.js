'use strict';

const OpenAI = require('openai');

const XAI_BASE_URL = 'https://api.x.ai/v1';

// Default cleanup prompt (can be overridden in settings)
const DEFAULT_PROMPT = `You are a dictation cleanup assistant. Your job:
1. Fix punctuation and capitalisation
2. Remove filler words (um, uh, like, you know)
3. Break into paragraphs when there is a natural pause or topic shift
4. DO NOT change the meaning or add content not said
Return ONLY the cleaned text — no explanation, no commentary.`;

/**
 * Enhance raw Whisper transcription using xAI Grok.
 * @param {string} rawText  - Raw transcription from Whisper
 * @param {object} settings - App settings object
 * @returns {Promise<string>} Enhanced text
 */
async function enhanceText (rawText, settings) {
  const { xaiApiKey, xaiModel, enhancementPrompt } = settings;

  if (!xaiApiKey?.trim()) return rawText;

  const client = new OpenAI({
    apiKey  : xaiApiKey.trim(),
    baseURL : XAI_BASE_URL,
  });

  const systemPrompt = enhancementPrompt?.trim() || DEFAULT_PROMPT;

  const response = await client.chat.completions.create({
    model    : xaiModel || 'grok-3-mini',
    messages : [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: rawText },
    ],
    max_tokens  : 4096,
    temperature : 0.2,   // low temp = faithful cleanup, not creative rewrite
  });

  const cleaned = response.choices?.[0]?.message?.content?.trim();
  return cleaned || rawText;  // Fall back to raw if Grok returns empty
}

module.exports = { enhanceText };

// Centralized AI model registry. All model names must come from here —
// never hardcode model strings inside components or services.
// Values can be overridden via environment variables for A/B testing or cost control.

export const AI_MODEL_REGISTRY = {
  // Chat & reasoning
  chatFast:              process.env.AI_MODEL_CHAT_FAST              || 'gpt-4o-mini',
  chatBalanced:          process.env.AI_MODEL_CHAT_BALANCED          || 'gpt-4o',
  strategicReport:       process.env.AI_MODEL_STRATEGIC_REPORT       || 'claude-opus-4-7',
  scenarioReasoning:     process.env.AI_MODEL_SCENARIO_REASONING     || 'claude-opus-4-7',

  // Audio
  audioTranscriptionFast:     process.env.AI_MODEL_AUDIO_FAST       || 'whisper-1',
  audioTranscriptionAccurate: process.env.AI_MODEL_AUDIO_ACCURATE   || 'gpt-4o-transcribe',
  audioDiarization:           process.env.AI_MODEL_AUDIO_DIARIZE    || 'gpt-4o-transcribe',
  textToSpeech:               process.env.AI_MODEL_TTS              || 'gpt-4o-mini-tts',

  // Embeddings & image
  embeddings:       process.env.AI_MODEL_EMBEDDINGS  || 'text-embedding-3-small',
  imageGeneration:  process.env.AI_MODEL_IMAGE       || 'dall-e-3',

  // Legacy (kept for backwards-compat during transition)
  geminiLegacy:     process.env.AI_MODEL_GEMINI_LEGACY || 'gemini-1.5-flash',
} as const;

export type AiModelKey = keyof typeof AI_MODEL_REGISTRY;

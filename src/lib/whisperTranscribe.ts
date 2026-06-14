/**
 * Whisper transcribe helper.
 *
 * Extraído de meetingsRouter pra ser reusado por outros bots
 * (secretária via WhatsApp, voterBot quando habilitarmos áudio, etc).
 *
 * Best-effort: nunca lança em erro de Whisper — devolve null e quem
 * chama decide se pede o usuário pra repetir ou ignora.
 */

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

export interface TranscribeOpts {
  audio: Buffer | ArrayBuffer | Uint8Array;
  /** MIME do áudio. Default: audio/ogg (formato típico do WhatsApp). */
  mimeType?: string;
  /** Idioma esperado (default 'pt'). */
  language?: string;
}

/**
 * Transcreve áudio via OpenAI Whisper. Devolve null se a chave não
 * estiver configurada ou se Whisper falhar.
 */
export async function transcribeAudio(opts: TranscribeOpts): Promise<string | null> {
  if (!OPENAI_KEY) {
    console.warn('[whisper] OPENAI_API_KEY ausente — não consigo transcrever.');
    return null;
  }
  const mime = opts.mimeType || 'audio/ogg';
  const ext = mime.includes('ogg') ? 'ogg'
    : mime.includes('mpeg') || mime.includes('mp3') ? 'mp3'
    : mime.includes('mp4') || mime.includes('m4a') ? 'mp4'
    : mime.includes('wav') ? 'wav'
    : 'webm';

  try {
    // Node 22: native FormData + Blob.
    // Copia para um ArrayBuffer DEDICADO (não SharedArrayBuffer) pra satisfazer
    // o BlobPart type do TypeScript.
    const src = Buffer.isBuffer(opts.audio)
      ? new Uint8Array(opts.audio.buffer, opts.audio.byteOffset, opts.audio.byteLength)
      : (opts.audio instanceof Uint8Array ? opts.audio : new Uint8Array(opts.audio as ArrayBuffer));
    const ab = new ArrayBuffer(src.byteLength);
    new Uint8Array(ab).set(src);
    const blob = new Blob([ab], { type: mime });
    const formData = new FormData();
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model', 'whisper-1');
    formData.append('language', opts.language || 'pt');
    formData.append('response_format', 'text');

    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: formData,
    });
    if (!r.ok) {
      const text = await r.text();
      console.warn(`[whisper] falha ${r.status}:`, text.slice(0, 200));
      return null;
    }
    const transcript = (await r.text()).trim();
    return transcript || null;
  } catch (err: any) {
    console.warn('[whisper] exceção:', err?.message || err);
    return null;
  }
}

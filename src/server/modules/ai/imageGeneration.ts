// Image generation helper. Tries Google Gemini 2.5 Flash Image first
// (codename "nano-banana"); falls back to OpenAI gpt-image-1.
// Returns a base64 data URL (image/png) so the caller can embed/store directly.

export function isImageGenerationConfigured(): boolean {
  return !!(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
}

export function activeImageProvider(): 'gemini' | 'openai' | null {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

type GenerateArgs = {
  prompt: string;
  size?: '1024x1024' | '1024x1536' | '1536x1024';
};

export async function generateImage(args: GenerateArgs): Promise<{ dataUrl: string; provider: 'gemini' | 'openai' }> {
  const { prompt, size = '1024x1024' } = args;
  const provider = activeImageProvider();

  if (provider === 'gemini') {
    const model = process.env.AI_MODEL_IMAGE_GEMINI || 'gemini-2.5-flash-image-preview';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini Image ${res.status}: ${errText.slice(0, 200)}`);
    }
    const json = (await res.json()) as any;
    const parts: any[] = json.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.data);
    if (!imagePart) {
      throw new Error('Gemini retornou sem imagem');
    }
    const mime = imagePart.inlineData.mimeType || 'image/png';
    return { dataUrl: `data:${mime};base64,${imagePart.inlineData.data}`, provider: 'gemini' };
  }

  if (provider === 'openai') {
    const model = process.env.AI_MODEL_IMAGE_OPENAI || 'gpt-image-1';
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ model, prompt, size, n: 1 }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI Image ${res.status}: ${errText.slice(0, 200)}`);
    }
    const json = (await res.json()) as any;
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI retornou sem b64_json');
    return { dataUrl: `data:image/png;base64,${b64}`, provider: 'openai' };
  }

  throw new Error('Nenhum provedor de imagem configurado (defina GEMINI_API_KEY ou OPENAI_API_KEY)');
}

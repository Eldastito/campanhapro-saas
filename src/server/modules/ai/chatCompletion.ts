// Provider-agnostic chat completion. Tries OpenAI first; falls back to
// Anthropic Claude when OPENAI_API_KEY is absent but CLAUDE_API_KEY is set.
// Anthropic does NOT offer an audio transcription endpoint, so audio routes
// (Whisper) still require OPENAI_API_KEY.

type ChatArgs = {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  model?: string; // optional override; otherwise uses provider default
  /** Força um provedor específico (cai pro outro se a chave do preferido faltar). */
  preferProvider?: 'openai' | 'claude';
};

function anthropicKey(): string | undefined {
  return process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
}

export function isChatConfigured(): boolean {
  return !!(process.env.OPENAI_API_KEY || anthropicKey());
}

export function activeChatProvider(): 'openai' | 'claude' | null {
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (anthropicKey()) return 'claude';
  return null;
}

/** Resolve o provedor honrando a preferência quando a respectiva chave existe. */
function resolveProvider(prefer?: 'openai' | 'claude'): 'openai' | 'claude' | null {
  if (prefer === 'openai' && process.env.OPENAI_API_KEY) return 'openai';
  if (prefer === 'claude' && anthropicKey()) return 'claude';
  return activeChatProvider();
}

export async function chatCompletion(args: ChatArgs): Promise<string> {
  const { system, user, maxTokens = 1200, temperature = 0.5, jsonMode = false, model } = args;
  const provider = resolveProvider(args.preferProvider);

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: model || process.env.AI_MODEL_CHAT_BALANCED || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
    }
    const json = (await res.json()) as any;
    return json.choices?.[0]?.message?.content ?? '';
  }

  if (provider === 'claude') {
    // Claude has no native JSON mode — instruct it explicitly and strip code fences afterwards.
    const systemForClaude = jsonMode
      ? `${system}\n\nIMPORTANTE: Responda APENAS com JSON válido. Sem texto antes ou depois, sem markdown, sem code fences.`
      : system;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey()!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || process.env.AI_MODEL_CLAUDE_FALLBACK || 'claude-sonnet-4-6',
        max_tokens: maxTokens,
        temperature,
        system: systemForClaude,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic ${res.status}: ${errText.slice(0, 200)}`);
    }
    const json = (await res.json()) as any;
    const text: string = json.content?.[0]?.text ?? '';
    if (jsonMode) {
      return text
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
    }
    return text;
  }

  throw new Error('Nenhum provedor de IA configurado (defina OPENAI_API_KEY ou CLAUDE_API_KEY)');
}

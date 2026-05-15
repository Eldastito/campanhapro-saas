/**
 * Server-side embeddings service. NEVER expose OpenAI keys to the frontend.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = process.env.AI_MODEL_EMBEDDINGS || 'text-embedding-3-small';

export async function embed(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY ausente — embeddings indisponíveis');
  }

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI embeddings failed: ${res.status} ${errText}`);
  }

  const json = (await res.json()) as { data: [{ embedding: number[] }] };
  return json.data[0].embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY ausente');
  }
  if (texts.length === 0) return [];

  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI embeddings batch failed: ${res.status} ${errText}`);
  }

  const json = (await res.json()) as { data: [{ embedding: number[]; index: number }] };
  return json.data
    .sort((a, b) => a.index - b.index)
    .map(d => d.embedding);
}

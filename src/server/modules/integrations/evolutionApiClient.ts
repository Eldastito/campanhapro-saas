/**
 * Evolution API client — talks to a self-hosted Evolution server.
 *
 * Adapted for Evolution GO v0.7+ (the Go rewrite), whose REST surface
 * differs substantially from the original Evolution API (Node):
 *   - Most operations identify the target instance via the "apikey"
 *     header (per-instance token), not via URL path
 *   - Webhook URL is configured during /instance/connect, not via
 *     a separate /webhook/set endpoint (which doesn't exist in Go)
 *   - Event names differ: MESSAGE / CONNECTION (Go) vs MESSAGES_UPSERT /
 *     CONNECTION_UPDATE (Node v2)
 *   - QR and status are separate endpoints (/instance/qr, /instance/status)
 *   - /instance/delete takes the instance UUID, not the name
 *   - /instance/create requires us to GENERATE the per-instance token
 *     client-side (Go responds 400 "token is required" without it, even
 *     though the OpenAPI marks it optional)
 *
 * Configuration (env vars, server-side only — NEVER expose to frontend):
 *   EVOLUTION_API_URL          base URL (e.g. https://evolutiongo.tesseractauto.com.br)
 *   EVOLUTION_GLOBAL_API_KEY   global API key (used to create instances)
 *   EVOLUTION_WEBHOOK_URL      public webhook URL base
 *   EVOLUTION_WEBHOOK_SECRET   optional shared secret; passed as ?secret= in the
 *                              webhook URL (the only place Go accepts auth on the
 *                              outbound webhook call)
 *
 * Per-instance tokens are generated here, returned to the caller, and
 * stored encrypted in whatsapp_instances.apiKey — they're only ever used
 * server-side.
 */
import { randomUUID } from 'crypto';

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '');
const EVOLUTION_GLOBAL_API_KEY = process.env.EVOLUTION_GLOBAL_API_KEY;
const EVOLUTION_WEBHOOK_URL = process.env.EVOLUTION_WEBHOOK_URL?.replace(/\/+$/, '');
const EVOLUTION_WEBHOOK_SECRET = process.env.EVOLUTION_WEBHOOK_SECRET;

// Evolution GO event names we want delivered to our webhook. The receiver
// also tolerates the legacy Node names for forwards compatibility.
const SUBSCRIBED_EVENTS = ['MESSAGE', 'SEND_MESSAGE', 'CONNECTION', 'QRCODE'];

export interface EvolutionCreateResult {
  instanceId: string;
  apiKey: string;
  qrCode?: string | null;
}

export interface EvolutionSendResult {
  messageId: string;
}

export type EvolutionStatus = 'pending' | 'qrcode' | 'connected' | 'disconnected';

export function isEvolutionConfigured(): boolean {
  return !!(EVOLUTION_API_URL && EVOLUTION_GLOBAL_API_KEY);
}

async function call<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE' | 'PUT',
  path: string,
  body: unknown | undefined,
  apiKey: string,
  instanceName?: string,
): Promise<T> {
  if (!EVOLUTION_API_URL) {
    throw new Error('evolution_not_configured');
  }
  // Timeout defensivo: sem isto, um servidor Evolution lento/indisponível trava
  // a requisição inteira (ex.: o delete nunca completava e o número não sumia).
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  // Headers no formato do exaforgeStudio (comprovado em produção): o token vai
  // em apikey + token + Authorization, e a INSTÂNCIA vai no header `instance`.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: apiKey,
    token: apiKey,
    Authorization: `Bearer ${apiKey}`,
  };
  if (instanceName) headers.instance = instanceName;
  let res: Response;
  try {
    res = await fetch(`${EVOLUTION_API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`evolution_${method}_${path}_${res.status}:${errText.slice(0, 200)}`);
  }
  // Some Go responses are empty (204) — tolerate
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Build the per-instance webhook URL we hand to Evolution. The optional
 * shared secret is appended as a query string param because Evolution GO
 * delivers webhooks to whatever URL we register and does not let us inject
 * custom headers.
 */
function buildWebhookUrl(instanceName: string): string | null {
  if (!EVOLUTION_WEBHOOK_URL) return null;
  const base = `${EVOLUTION_WEBHOOK_URL}/evolution/${encodeURIComponent(instanceName)}`;
  return EVOLUTION_WEBHOOK_SECRET
    ? `${base}?secret=${encodeURIComponent(EVOLUTION_WEBHOOK_SECRET)}`
    : base;
}

/**
 * Create a new instance and immediately connect it with our webhook URL.
 * Evolution GO splits this into two HTTP calls (POST /instance/create,
 * then POST /instance/connect); we do both here so the caller sees a single
 * atomic step.
 *
 * The instanceName must be globally unique inside the Evolution server.
 * Caller convention: `cp_${campaignId}_${slug}`.
 *
 * Returns the per-instance token (used as the apikey for all subsequent
 * calls) and the initial QR code if pairing is required immediately.
 */
export async function createInstance(instanceName: string): Promise<EvolutionCreateResult> {
  if (!EVOLUTION_GLOBAL_API_KEY) throw new Error('evolution_not_configured');

  // Evolution GO requires `token` in the create payload — we generate a
  // random UUID and keep it as the per-instance apikey for all subsequent
  // calls. (Yes, the swagger says it's optional. Yes, the implementation
  // returns 400 "token is required" without it. We tested.)
  const token = randomUUID();

  // Step 1: create the instance shell. We provide name + token; Go
  // autogenerates the id (UUID).
  const created = await call<any>(
    'POST',
    '/instance/create',
    { name: instanceName, token },
    EVOLUTION_GLOBAL_API_KEY,
  );
  // Response shape varies (Go wraps in { data: { ... } }; some versions
  // return the fields at top level). Tolerate both, and fall back to the
  // token we generated if the response omits it (the value we sent is the
  // value that's now valid).
  const inst = created?.data ?? created ?? {};
  const instanceId: string = inst.id ?? inst.instanceId ?? '';
  const apiKey: string = inst.token ?? inst.apikey ?? token;

  if (!apiKey) {
    throw new Error('evolution_create_no_token');
  }

  // Step 2: connect with webhook + event subscriptions (uses per-instance token).
  // Non-fatal: if connect fails, the instance still exists and caller can
  // retry via setWebhook() — failing here would leave an orphan.
  const webhookUrl = buildWebhookUrl(instanceName);
  await call(
    'POST',
    '/instance/connect',
    {
      webhookUrl: webhookUrl ?? '',
      subscribe: SUBSCRIBED_EVENTS,
    },
    apiKey,
  ).catch((err) => {
    console.warn('[Evolution] connect/webhook failed (non-fatal):', err.message);
  });

  // Step 3: NÃO bloqueia esperando o QR. O Evolution GO não devolve o QR no
  // create/connect — ele entrega via webhook (categoria QRCODE) logo em seguida.
  // Tentar GET aqui só deixava a criação lenta (até travar em "Criando...").
  // Uma tentativa única e RÁPIDA (best-effort, sem travar) — se vier, ótimo;
  // senão o frontend faz poll do lastQRCode preenchido pelo webhook.
  let qrCode: string | null = null;
  try {
    const qr = await call<any>('GET', '/instance/qr', undefined, apiKey);
    qrCode = extractQrImage(qr);
  } catch {
    // segue sem QR — chega pelo webhook
  }

  return {
    instanceId: instanceId || instanceName,
    apiKey,
    qrCode,
  };
}

/**
 * Fetch a fresh QR code for pairing. Used when the user lost the original
 * QR or it expired (Evolution QR codes are valid for ~60 seconds).
 *
 * Evolution GO identifies the instance via the apikey header, so the
 * instanceName param is unused but kept for signature stability.
 */
/**
 * Extrai a IMAGEM do QR (base64 PNG) de respostas do Evolution GO/Node.
 * O GO devolve em data.Qrcode (P maiúsculo!); outras versões usam base64/qrcode.
 * (data.Code é a string crua de pareamento — não renderiza como <img>, ignorada.)
 */
function extractQrImage(obj: any): string | null {
  if (!obj) return null;
  const d = obj.data ?? obj;
  return (
    d?.Qrcode ?? d?.qrcode ?? d?.QRCode ?? d?.base64 ?? d?.qr ??
    obj?.Qrcode ?? obj?.qrcode ?? obj?.base64 ?? obj?.qr ?? null
  );
}

export async function getQRCode(
  instanceName: string,
  apiKey: string,
): Promise<{ qrCode: string | null; status: EvolutionStatus }> {
  // Evolution GO gera o QR ao (re)ARMAR a sessão de pareamento via
  // POST /instance/connect — e o entrega via GET dedicado E/OU empurra via
  // webhook (categoria QRCODE). Um GET de QR SEM connect antes retorna 401
  // ("not authorized" = sem sessão ativa), que era a causa do QR nunca aparecer.
  const webhookUrl = buildWebhookUrl(instanceName);
  // connect-first: pode lançar 401/404 se o token estiver órfão — deixamos
  // propagar para o router reprovisionar.
  await call<any>(
    'POST',
    '/instance/connect',
    { webhookUrl: webhookUrl ?? '', subscribe: SUBSCRIBED_EVENTS },
    apiKey,
    instanceName,
  );

  // O path do QR varia entre versões do GO: /instance/qr (por header) e
  // /instance/{name}/qrcode (por path). Tentamos ambos; se nenhum trouxer
  // inline, o webhook terá entregue o QR (o caller lê de lastQRCode).
  let qrCode: string | null = null;
  for (const path of ['/instance/qr', `/instance/${encodeURIComponent(instanceName)}/qrcode`]) {
    try {
      const qr = await call<any>('GET', path, undefined, apiKey, instanceName);
      qrCode = extractQrImage(qr);
      if (qrCode) break;
    } catch {
      // tenta o próximo / QR chegará via webhook
    }
  }
  return { qrCode, status: qrCode ? 'qrcode' : 'pending' };
}

/**
 * Poll connection state.
 * Evolution GO returns a shape like { connected: true|false, state: 'open'|'connecting'|'close' }
 * — we tolerate both top-level and { data: {...} } wrapping.
 */
export async function getStatus(
  instanceName: string,
  apiKey: string,
): Promise<EvolutionStatus> {
  try {
    const token = EVOLUTION_GLOBAL_API_KEY || apiKey;
    const result = await call<any>('GET', '/instance/status', undefined, token, instanceName);
    const d = result?.data ?? result ?? {};
    // Evolution GO devolve PascalCase: { Connected: bool, LoggedIn: bool, Name }.
    // Toleramos também minúsculas/state de outras versões.
    const connected = d.Connected ?? d.connected;
    const loggedIn = d.LoggedIn ?? d.loggedIn;
    const state = String(d.state ?? d.State ?? d.status ?? '').toLowerCase();
    if (loggedIn === true) return 'connected';               // pareado/autenticado
    if (state === 'open' || state === 'connected') return 'connected';
    if (connected === true && loggedIn === false) return 'qrcode'; // socket aberto, aguardando pareamento
    if (connected === true) return 'connected';
    if (state === 'connecting' || d.qrcode || d.Qrcode) return 'qrcode';
    return 'disconnected';
  } catch {
    return 'disconnected';
  }
}

/**
 * Send a text message via this instance.
 * Evolution GO (formato do exaforgeStudio, comprovado): POST /send/text com
 * body { number, text, delay } e a instância no header `instance`.
 * Prioriza a GLOBAL key do ambiente (fonte da verdade no deploy) sobre a key
 * salva no banco — evita um token antigo/errado vencer.
 */
export async function sendText(
  instanceName: string,
  apiKey: string,
  to: string,
  text: string,
): Promise<EvolutionSendResult> {
  const token = EVOLUTION_GLOBAL_API_KEY || apiKey;
  const result = await call<any>(
    'POST',
    '/send/text',
    { number: to, text, delay: 1200 },
    token,
    instanceName,
  );
  const messageId =
    result?.data?.id ??
    result?.data?.messageId ??
    result?.data?.key?.id ??
    result?.id ??
    result?.messageId ??
    result?.key?.id ??
    '';
  return { messageId };
}

/**
 * Re-register the webhook URL for an existing instance. In Evolution GO this
 * means calling /instance/connect again with the desired webhookUrl (there's
 * no separate /webhook/set endpoint).
 */
export async function setWebhook(instanceName: string, apiKey: string): Promise<void> {
  if (!EVOLUTION_WEBHOOK_URL) throw new Error('evolution_webhook_url_not_configured');
  // Chave global do ambiente é a fonte da verdade (esquema do exaforge): a
  // instância é identificada pelo header `instance`, então o token salvo no
  // banco pode estar defasado sem quebrar o registro do webhook.
  const token = EVOLUTION_GLOBAL_API_KEY || apiKey;
  await call(
    'POST',
    '/instance/connect',
    {
      webhookUrl: buildWebhookUrl(instanceName),
      subscribe: SUBSCRIBED_EVENTS,
    },
    token,
    instanceName,
  );
}

/**
 * Tenta reabrir o socket de uma instância já pareada que caiu (sem re-escanear
 * QR). Best-effort — usado para auto-recuperar quedas transitórias de sessão.
 */
export async function reconnectInstance(apiKey: string): Promise<void> {
  await call('POST', '/instance/reconnect', undefined, apiKey).catch(() => {});
}

/**
 * Descobre o UUID (instanceId) de uma instância pelo nome, via GET /instance/all
 * (rota Admin, usa a GLOBAL key). Usado no delete quando não temos o id salvo —
 * a rota /instance/delete/:id do GO exige o UUID. Tolerante a camelCase/PascalCase.
 */
export async function findInstanceIdByName(instanceName: string): Promise<string | null> {
  if (!EVOLUTION_GLOBAL_API_KEY) return null;
  try {
    const all = await call<any>('GET', '/instance/all', undefined, EVOLUTION_GLOBAL_API_KEY);
    const list: any[] = Array.isArray(all) ? all : (all?.data ?? all?.instances ?? all?.Data ?? []);
    const match = (Array.isArray(list) ? list : []).find(
      (i: any) => (i?.name ?? i?.Name ?? i?.instanceName ?? i?.InstanceName) === instanceName,
    );
    if (!match) return null;
    return String(match.id ?? match.Id ?? match.ID ?? match.instanceId ?? '') || null;
  } catch {
    return null;
  }
}

/**
 * Permanently delete an instance from the Evolution server.
 *
 * Evolution GO needs the UUID instance id (not the human name) for the
 * DELETE call — callers pass it from our own whatsapp_instances.instanceId
 * column. If absent we still issue the logout (which frees the WhatsApp
 * session) and log a warning so the orphan stands out in monitoring.
 */
export async function deleteInstance(
  _instanceName: string,
  apiKey: string,
  instanceId?: string,
): Promise<void> {
  try {
    // Logout first to drop the WhatsApp socket — Go takes no path param here.
    await call('DELETE', '/instance/logout', undefined, apiKey).catch(() => {});
    if (instanceId) {
      // /instance/delete/:id é rota Admin — usa a GLOBAL key (cai pro token da
      // instância se a global não estiver configurada).
      await call(
        'DELETE',
        `/instance/delete/${encodeURIComponent(instanceId)}`,
        undefined,
        EVOLUTION_GLOBAL_API_KEY || apiKey,
      ).catch((e) => console.warn('[Evolution] delete/:id falhou (seguindo):', e?.message));
    } else {
      console.warn(
        '[Evolution] deleteInstance: no instanceId UUID supplied — issued logout only; instance row remains in Evolution',
      );
    }
  } catch (err: any) {
    // Surface but don't crash callers — instance may already be gone
    console.warn('[Evolution] delete instance failed:', err.message);
  }
}

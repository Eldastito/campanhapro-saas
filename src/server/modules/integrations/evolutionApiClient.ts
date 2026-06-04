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
): Promise<T> {
  if (!EVOLUTION_API_URL) {
    throw new Error('evolution_not_configured');
  }
  const res = await fetch(`${EVOLUTION_API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
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
      immediate: true,
    },
    apiKey,
  ).catch((err) => {
    console.warn('[Evolution] connect/webhook failed (non-fatal):', err.message);
  });

  // Step 3: ask for an initial QR. May not be ready yet on a freshly-created
  // instance — caller can poll via getQRCode().
  let qrCode: string | null = null;
  try {
    const qr = await call<any>('GET', '/instance/qr', undefined, apiKey);
    qrCode =
      qr?.base64 ??
      qr?.data?.base64 ??
      qr?.qrcode ??
      qr?.data?.qrcode ??
      null;
  } catch {
    // ignore — caller will poll
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
export async function getQRCode(
  _instanceName: string,
  apiKey: string,
): Promise<{ qrCode: string | null; status: EvolutionStatus }> {
  const qr = await call<any>('GET', '/instance/qr', undefined, apiKey);
  const qrCode =
    qr?.base64 ??
    qr?.data?.base64 ??
    qr?.qrcode ??
    qr?.data?.qrcode ??
    null;
  return { qrCode, status: qrCode ? 'qrcode' : 'pending' };
}

/**
 * Poll connection state.
 * Evolution GO returns a shape like { connected: true|false, state: 'open'|'connecting'|'close' }
 * — we tolerate both top-level and { data: {...} } wrapping.
 */
export async function getStatus(
  _instanceName: string,
  apiKey: string,
): Promise<EvolutionStatus> {
  try {
    const result = await call<any>('GET', '/instance/status', undefined, apiKey);
    const data = result?.data ?? result ?? {};
    if (data?.connected === true || data?.state === 'open') return 'connected';
    if (data?.state === 'connecting' || data?.qrcode) return 'qrcode';
    return 'disconnected';
  } catch {
    return 'disconnected';
  }
}

/**
 * Send a text message via this instance.
 * Evolution GO: POST /send/text with body { to, text } — instance via apikey.
 * `to` should be E.164 without '+'.
 */
export async function sendText(
  _instanceName: string,
  apiKey: string,
  to: string,
  text: string,
): Promise<EvolutionSendResult> {
  const result = await call<any>(
    'POST',
    '/send/text',
    { to, text },
    apiKey,
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
  await call(
    'POST',
    '/instance/connect',
    {
      webhookUrl: buildWebhookUrl(instanceName),
      subscribe: SUBSCRIBED_EVENTS,
      immediate: false,
    },
    apiKey,
  );
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
      await call(
        'DELETE',
        `/instance/delete/${encodeURIComponent(instanceId)}`,
        undefined,
        apiKey,
      );
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

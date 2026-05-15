import { supabase } from '../lib/supabaseClient';

export type GeoStatus = 'ok' | 'denied' | 'unsupported' | 'timeout' | 'error' | 'unknown';

interface CapturedGeo {
    lat: number | null;
    lng: number | null;
    accuracy: number | null;
    status: GeoStatus;
}

/**
 * Pega a posição atual do navegador SEM bloquear o fluxo.
 * Promise resolve em até GEO_TIMEOUT_MS mesmo sem permissão.
 * Não dispara prompt extra: usa a permissão já concedida (ou negada) pelo usuário.
 */
const GEO_TIMEOUT_MS = 4_000;

const captureGeo = (): Promise<CapturedGeo> => {
    return new Promise((resolve) => {
        if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
            resolve({ lat: null, lng: null, accuracy: null, status: 'unsupported' });
            return;
        }
        let settled = false;
        const settle = (g: CapturedGeo) => {
            if (!settled) {
                settled = true;
                resolve(g);
            }
        };

        // Hard timeout em paralelo: nunca trava o submit por mais de GEO_TIMEOUT_MS.
        const timer = setTimeout(
            () => settle({ lat: null, lng: null, accuracy: null, status: 'timeout' }),
            GEO_TIMEOUT_MS
        );

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                clearTimeout(timer);
                settle({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    status: 'ok',
                });
            },
            (err) => {
                clearTimeout(timer);
                settle({
                    lat: null,
                    lng: null,
                    accuracy: null,
                    status: err.code === err.PERMISSION_DENIED ? 'denied' : 'error',
                });
            },
            { enableHighAccuracy: true, maximumAge: 30_000, timeout: GEO_TIMEOUT_MS }
        );
    });
};

interface LogSubmissionParams {
    campaignId: string | undefined;
    userId?: string | null;
    action: string;
    targetTable?: string;
    targetId?: string | null;
}

/**
 * Registra geolocalização de uma submissão. NÃO bloqueia o fluxo do submit:
 * - Falhas (RLS, rede, GPS off) são engolidas com console.warn.
 * - Pra forms anônimos (PublicCapturePage), passar userId=null e usar role anon.
 *
 * Use SEMPRE depois de o INSERT principal ter dado certo, passando o targetId
 * retornado pelo Supabase pra correlação.
 */
export async function logSubmissionGeo({
    campaignId,
    userId,
    action,
    targetTable,
    targetId,
}: LogSubmissionParams): Promise<void> {
    if (!campaignId) return;
    try {
        const geo = await captureGeo();
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null;
        const { error } = await supabase.from('submission_geo_log').insert({
            campaignId,
            userId: userId ?? null,
            action,
            targetTable: targetTable ?? null,
            targetId: targetId ?? null,
            lat: geo.lat,
            lng: geo.lng,
            accuracy: geo.accuracy,
            geoStatus: geo.status,
            userAgent: ua,
        });
        if (error) console.warn('[geoTracking] Falha ao gravar log:', error.message);
    } catch (err) {
        console.warn('[geoTracking] Exceção:', err);
    }
}

/**
 * Utilitários de captura para a comprovação geolocalizada do Partido.
 *
 * captureGeo segue o MESMO padrão comprovado em produção (src/utils/geoTracking.ts
 * e ShareLocationButton): NUNCA rejeita — sempre resolve com um `status`. O GPS é
 * best-effort e se ANEXA ao registro; nunca BLOQUEIA o salvamento. A ausência de
 * GPS é um sinal de comprovação fraca (que o presidente vê), não um erro fatal.
 */
export type GeoStatus = 'ok' | 'denied' | 'unsupported' | 'timeout' | 'error';

export interface CapturedGeo {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  status: GeoStatus;
}

export const GEO_MESSAGES: Record<GeoStatus, string> = {
  ok: 'Localização capturada ✅',
  denied: 'Permissão de localização negada pelo navegador.',
  unsupported: 'Este navegador não oferece GPS.',
  timeout: 'Sem sinal de GPS a tempo. Tente ao ar livre ou no Chrome/Safari.',
  error: 'Não foi possível obter sua localização.',
};

const GEO_TIMEOUT_MS = 12_000;

export const captureGeo = (): Promise<CapturedGeo> =>
  new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return resolve({ lat: null, lng: null, accuracy: null, status: 'unsupported' });
    }
    let settled = false;
    const settle = (g: CapturedGeo) => { if (!settled) { settled = true; resolve(g); } };
    // Timeout paralelo: nunca trava o submit além de GEO_TIMEOUT_MS.
    const timer = setTimeout(() => settle({ lat: null, lng: null, accuracy: null, status: 'timeout' }), GEO_TIMEOUT_MS);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(timer); settle({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, status: 'ok' }); },
      (e) => { clearTimeout(timer); settle({ lat: null, lng: null, accuracy: null, status: e?.code === 1 ? 'denied' : 'error' }); },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: GEO_TIMEOUT_MS },
    );
  });

/**
 * Detecta navegador EMBUTIDO (WhatsApp/Instagram/Facebook/webview Android), que
 * costuma bloquear o GPS sem permitir liberar. Nesses casos orientamos a abrir
 * no Chrome/Safari.
 */
export const isInAppBrowser = (): boolean => {
  const ua = (navigator.userAgent || '').toLowerCase();
  return /\bwv\b|fban|fbav|fb_iab|instagram|line\/|micromessenger|gsa\//.test(ua)
    || (/\bandroid\b/.test(ua) && /version\/[\d.]+/.test(ua) && /chrome\/[\d.]+ mobile/.test(ua) === false && /\bwv\b/.test(ua));
};

export const compressImage = (file: File, max = 800, quality = 0.5): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > max) { height = Math.round((height * max) / width); width = max; }
        else if (height >= width && height > max) { width = Math.round((width * max) / height); height = max; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d')?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => reject(new Error('Falha ao processar a imagem.'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    reader.readAsDataURL(file);
  });

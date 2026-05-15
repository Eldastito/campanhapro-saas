import * as React from 'react';
import { MapPin, MapPinOff, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../contexts/AuthContext';
import Modal from '../ui/Modal';

const PING_INTERVAL_MS = 60_000; // 1 ping por minuto (suficiente para mapa colaborativo)

/**
 * Botão "Compartilhar minha localização" — opt-in.
 * - Mostra modal de consentimento explicando o que vai ser feito.
 * - Após aceite, usa navigator.geolocation.watchPosition.
 * - Faz upsert em team_locations_live no máximo a cada PING_INTERVAL_MS.
 * - Botão "Parar" deleta o registro (some do mapa imediatamente).
 */
const ShareLocationButton: React.FC = () => {
    const { user } = useAuth();
    const [sharing, setSharing] = React.useState(false);
    const [askingConsent, setAskingConsent] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [lastPingAt, setLastPingAt] = React.useState<number | null>(null);
    const watchIdRef = React.useRef<number | null>(null);
    const lastSentRef = React.useRef<number>(0);

    const stopSharing = React.useCallback(async () => {
        if (watchIdRef.current != null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
        }
        setSharing(false);
        setLastPingAt(null);
        if (user?.id) {
            await supabase.from('team_locations_live').delete().eq('userId', user.id);
        }
    }, [user?.id]);

    // Cleanup ao desmontar.
    React.useEffect(() => {
        return () => {
            if (watchIdRef.current != null) {
                navigator.geolocation.clearWatch(watchIdRef.current);
            }
        };
    }, []);

    const startSharing = () => {
        if (!user?.id || !user?.campaignId) {
            setError('Usuário sem campanha vinculada — faça login novamente.');
            return;
        }
        if (!('geolocation' in navigator)) {
            setError('Seu navegador não oferece geolocalização.');
            return;
        }
        setError(null);
        setAskingConsent(false);

        watchIdRef.current = navigator.geolocation.watchPosition(
            async (pos) => {
                const now = Date.now();
                // Throttle: só envia 1x por PING_INTERVAL_MS (mesmo que GPS dispare mais).
                if (now - lastSentRef.current < PING_INTERVAL_MS) return;
                lastSentRef.current = now;

                const { error: upErr } = await supabase
                    .from('team_locations_live')
                    .upsert({
                        userId: user.id,
                        campaignId: user.campaignId,
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        accuracy: pos.coords.accuracy,
                        recordedAt: new Date().toISOString(),
                    }, { onConflict: 'user_id' });
                if (upErr) {
                    console.error('[ShareLocation] Erro ao gravar posição:', upErr);
                    setError(upErr.message);
                } else {
                    setLastPingAt(now);
                }
            },
            (err) => {
                console.error('[ShareLocation] Erro do GPS:', err);
                setError(
                    err.code === err.PERMISSION_DENIED
                        ? 'Permissão de localização negada pelo navegador.'
                        : 'Não foi possível obter sua localização.'
                );
                stopSharing();
            },
            { enableHighAccuracy: true, maximumAge: 30_000, timeout: 30_000 }
        );
        setSharing(true);
    };

    if (sharing) {
        return (
            <div className="bg-emerald-900/20 border border-emerald-500/30 rounded-2xl p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                    <div className="relative flex-shrink-0">
                        <MapPin className="w-5 h-5 text-emerald-400" />
                        <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-bold text-emerald-300">Compartilhando localização</p>
                        <p className="text-[11px] text-slate-400">
                            {lastPingAt
                                ? `Último ping: ${new Date(lastPingAt).toLocaleTimeString()}`
                                : 'Aguardando GPS...'}
                        </p>
                    </div>
                </div>
                <button
                    onClick={stopSharing}
                    className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-bold flex items-center gap-2 flex-shrink-0"
                >
                    <MapPinOff className="w-4 h-4" /> Parar
                </button>
            </div>
        );
    }

    return (
        <>
            <button
                onClick={() => setAskingConsent(true)}
                className="w-full sm:w-auto px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center justify-center gap-2 transition-all"
            >
                <MapPin className="w-5 h-5" /> Compartilhar minha localização
            </button>

            {error && (
                <p className="text-xs text-red-400 mt-2">{error}</p>
            )}

            {askingConsent && (
                <Modal isOpen={true} onClose={() => setAskingConsent(false)} title="Compartilhar localização">
                    <div className="space-y-4 text-sm text-slate-300">
                        <div className="flex items-start gap-3">
                            <ShieldCheck className="w-6 h-6 text-emerald-400 flex-shrink-0 mt-0.5" />
                            <div>
                                <p className="font-bold mb-1">O que vai acontecer:</p>
                                <ul className="list-disc list-inside space-y-1 text-slate-400">
                                    <li>Sua localização será visível no mapa apenas para a coordenação da <b>sua campanha</b>.</li>
                                    <li>Atualizações a cada ~1 minuto enquanto esta tela estiver aberta.</li>
                                    <li>Você pode parar a qualquer momento — o ponto some do mapa imediatamente.</li>
                                    <li>Não é gravado histórico de trajeto, apenas a posição mais recente.</li>
                                </ul>
                            </div>
                        </div>

                        <p className="text-[11px] text-slate-500 bg-slate-800/50 p-3 rounded-lg">
                            O navegador pedirá permissão. Sem permissão, nada é enviado.
                        </p>

                        <div className="flex gap-2 justify-end pt-2">
                            <button
                                onClick={() => setAskingConsent(false)}
                                className="px-4 py-2 rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-700 text-sm"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={startSharing}
                                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm flex items-center gap-2"
                            >
                                <Loader2 className="w-4 h-4 animate-spin" style={{ display: 'none' }} />
                                Aceitar e compartilhar
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
};

export default ShareLocationButton;

import * as React from 'react';
import { Mic, MicOff, Loader2, X, Check, Edit3 } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

/**
 * Comando de voz pra agenda — multi-turn com validação rigorosa.
 *
 * Fluxo:
 *   1. Click → SpeechRecognition em modo CONTÍNUO (ouve até 4s de silêncio)
 *      enquanto mostra a transcrição parcial em tempo real
 *   2. Para automaticamente quando detecta silêncio prolongado, OU usuário clica "Parar"
 *   3. Manda transcrição final pro /api/agents/secretary
 *   4. Se IA pede MAIS INFO → mostra cartão amarelo + botão pra continuar (voz ou texto)
 *   5. Se IA monta evento PENDENTE → mostra cartão verde com resumo + Confirmar/Cancelar
 *      (também aceita "sim/confirma/pode" por voz)
 *   6. Confirmou → server salva → fala "Salvo na agenda" + atualiza lista
 */
interface Props {
    campaignId: string | undefined;
    onChanged?: () => void;
}

interface SecretaryResponse {
    action: 'need_more_info' | 'pending_confirmation' | 'confirm_save' | 'cancel' | 'delete' | 'update' | 'list' | 'unclear' | 'error';
    extracted?: Record<string, any>;
    missing_fields?: string[];
    event?: any;
    speech_response?: string;
    executed?: boolean;
    error?: string;
}

const FIELD_LABEL: Record<string, string> = {
    title: 'O quê',
    starts_at: 'Data e hora',
    location: 'Local',
    with_whom: 'Com quem',
    priority: 'Prioridade',
};

const SILENCE_TIMEOUT_MS = 4000;  // 4s de silêncio = parou de falar

const VoiceCommandButton: React.FC<Props> = ({ campaignId, onChanged }) => {
    const [listening, setListening] = React.useState(false);
    const [processing, setProcessing] = React.useState(false);
    const [transcriptLive, setTranscriptLive] = React.useState('');
    const [response, setResponse] = React.useState<SecretaryResponse | null>(null);
    const [pendingContext, setPendingContext] = React.useState<{ extracted?: any; pendingEvent?: any; awaitingFields?: string[] } | null>(null);
    const [textInput, setTextInput] = React.useState('');

    const recognitionRef = React.useRef<any>(null);
    const silenceTimerRef = React.useRef<NodeJS.Timeout | null>(null);
    const finalTranscriptRef = React.useRef('');

    const supportsSpeech = typeof window !== 'undefined' &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

    const speak = (text: string) => {
        if (typeof window === 'undefined' || !window.speechSynthesis || !text) return;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'pt-BR';
        u.rate = 1.0;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
    };

    const sendCommand = async (cmd: string, context?: typeof pendingContext) => {
        if (!campaignId || !cmd.trim()) return;
        setProcessing(true);
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const r = await fetch('/api/agents/secretary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
                body: JSON.stringify({ campaignId, command: cmd, context: context || undefined }),
            });
            const json: SecretaryResponse = await r.json();
            if (!r.ok) {
                setResponse({ action: 'error', error: (json as any).error || `HTTP ${r.status}` });
                speak('Houve um erro.');
                return;
            }

            if (json.speech_response) speak(json.speech_response);
            setResponse(json);

            // Atualiza contexto pra próximo turno (multi-turn)
            if (json.action === 'need_more_info') {
                setPendingContext({ extracted: json.extracted, awaitingFields: json.missing_fields });
            } else if (json.action === 'pending_confirmation') {
                setPendingContext({ pendingEvent: json.event });
            } else if (json.action === 'confirm_save' || json.action === 'cancel') {
                setPendingContext(null);
                if (json.executed) onChanged?.();
            }
        } catch (err: any) {
            setResponse({ action: 'error', error: err?.message || String(err) });
            speak('Erro de conexão.');
        } finally {
            setProcessing(false);
            setTranscriptLive('');
            finalTranscriptRef.current = '';
        }
    };

    const stopListening = React.useCallback(() => {
        try { recognitionRef.current?.stop(); } catch {}
        if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
        setListening(false);

        const final = finalTranscriptRef.current.trim();
        if (final.length >= 1) {
            sendCommand(final, pendingContext || undefined);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingContext, campaignId]);

    const startListening = () => {
        if (!supportsSpeech) {
            alert('Seu navegador não suporta comando de voz. Use Chrome ou Edge.');
            return;
        }
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const rec = new SpeechRecognition();
        rec.lang = 'pt-BR';
        rec.continuous = true;          // continua ouvindo mesmo após pausa
        rec.interimResults = true;      // mostra transcrição parcial enquanto fala
        rec.maxAlternatives = 1;

        finalTranscriptRef.current = '';
        setTranscriptLive('');

        rec.onstart = () => {
            setListening(true);
            setResponse(null);
        };

        rec.onresult = (event: any) => {
            // Reset do timer de silêncio sempre que chega novo som
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const r = event.results[i];
                if (r.isFinal) {
                    finalTranscriptRef.current += r[0].transcript + ' ';
                } else {
                    interim += r[0].transcript;
                }
            }
            setTranscriptLive((finalTranscriptRef.current + interim).trim());

            // Após 4s sem novo som, considera que terminou
            silenceTimerRef.current = setTimeout(() => {
                stopListening();
            }, SILENCE_TIMEOUT_MS);
        };

        rec.onerror = (event: any) => {
            if (event.error === 'no-speech') {
                // não fecha tudo — só reseta o feedback
                setTranscriptLive('Não detectei fala. Tenta de novo.');
                return;
            }
            setListening(false);
            const msg = event.error === 'not-allowed'
                ? 'Permissão de microfone negada.'
                : `Erro: ${event.error}`;
            setResponse({ action: 'error', error: msg });
        };

        rec.onend = () => {
            setListening(false);
            // se ainda há transcrição não enviada (caso rec.end sem stopListening), envia agora.
            const final = finalTranscriptRef.current.trim();
            if (final.length >= 1 && !processing) {
                sendCommand(final, pendingContext || undefined);
            }
        };

        recognitionRef.current = rec;
        rec.start();
    };

    const handleConfirm = () => {
        if (!response?.event) return;
        sendCommand('sim, pode salvar', { pendingEvent: response.event });
    };
    const handleCancel = () => {
        setResponse(null);
        setPendingContext(null);
        setTextInput('');
    };
    const handleTextSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!textInput.trim()) return;
        sendCommand(textInput.trim(), pendingContext || undefined);
        setTextInput('');
    };

    if (!supportsSpeech) return null;

    return (
        <div className="flex flex-col items-end gap-2 max-w-md">
            <div className="flex items-center gap-2">
                <button
                    onClick={listening ? stopListening : startListening}
                    disabled={processing || !campaignId}
                    className={`px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                        listening
                            ? 'bg-red-600 hover:bg-red-500 text-white animate-pulse'
                            : processing
                                ? 'bg-slate-700 text-slate-300'
                                : 'bg-amber-600 hover:bg-amber-500 text-white'
                    }`}
                    title="Fala um comando de agenda. Aguarda 4s de silêncio pra processar."
                >
                    {processing ? <Loader2 className="w-4 h-4 animate-spin" /> :
                     listening ? <MicOff className="w-4 h-4" /> :
                     <Mic className="w-4 h-4" />}
                    {processing ? 'Processando...' : listening ? 'Parar e enviar' : 'Voz'}
                </button>
            </div>

            {/* Transcrição em tempo real */}
            {(listening || transcriptLive) && (
                <div className="bg-slate-800/80 border border-amber-500/30 rounded-xl px-3 py-2 max-w-full">
                    <p className="text-[10px] uppercase tracking-wider text-amber-400 mb-1">
                        {listening ? '🎙️ Ouvindo... (para após 4s de silêncio)' : 'Você disse:'}
                    </p>
                    <p className="text-sm text-slate-200">{transcriptLive || '...'}</p>
                </div>
            )}

            {/* Resposta da IA — need_more_info: pede campos faltantes */}
            {response?.action === 'need_more_info' && (
                <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-3 max-w-full">
                    <p className="text-xs font-bold text-yellow-300 mb-1">Faltam dados:</p>
                    <ul className="text-xs text-yellow-200 mb-2 space-y-0.5">
                        {(response.missing_fields || []).map(f => (
                            <li key={f}>• {FIELD_LABEL[f] || f}</li>
                        ))}
                    </ul>
                    <p className="text-xs text-slate-300 italic mb-2">"{response.speech_response}"</p>
                    <div className="flex gap-2">
                        <button onClick={startListening} disabled={listening || processing}
                            className="flex-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center justify-center gap-1">
                            <Mic className="w-3 h-3" /> Falar resposta
                        </button>
                        <button onClick={handleCancel} className="text-xs text-slate-400 px-2">Cancelar</button>
                    </div>
                    <form onSubmit={handleTextSubmit} className="mt-2 flex gap-1">
                        <input value={textInput} onChange={e => setTextInput(e.target.value)} placeholder="...ou digite a resposta"
                            className="flex-1 bg-slate-900 border border-slate-700 rounded-md px-2 py-1 text-xs text-slate-200" />
                        <button type="submit" disabled={!textInput.trim() || processing}
                            className="bg-slate-700 hover:bg-slate-600 px-2 rounded-md disabled:opacity-50">
                            <Edit3 className="w-3 h-3" />
                        </button>
                    </form>
                </div>
            )}

            {/* pending_confirmation: mostra resumo e pede confirmação */}
            {response?.action === 'pending_confirmation' && response.event && (
                <div className="bg-emerald-500/10 border border-emerald-500/40 rounded-xl p-3 max-w-full">
                    <p className="text-xs font-bold text-emerald-300 mb-2">Confirmar criação:</p>
                    <ul className="text-xs text-slate-200 space-y-1 mb-3">
                        <li><b>Título:</b> {response.event.title}</li>
                        <li><b>Quando:</b> {new Date(response.event.starts_at).toLocaleString('pt-BR')}</li>
                        <li><b>Local:</b> {response.event.location}</li>
                        <li><b>Com:</b> {response.event.with_whom}</li>
                        <li><b>Prioridade:</b> {response.event.priority}</li>
                    </ul>
                    <div className="flex gap-2">
                        <button onClick={handleConfirm} disabled={processing}
                            className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-3 py-2 rounded-lg flex items-center justify-center gap-1">
                            <Check className="w-3 h-3" /> Confirmar e salvar
                        </button>
                        <button onClick={handleCancel}
                            className="bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs px-3 py-2 rounded-lg flex items-center gap-1">
                            <X className="w-3 h-3" /> Cancelar
                        </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-2 italic">Ou diga "confirma" / "cancela" pra mim.</p>
                </div>
            )}

            {/* Sucesso */}
            {response?.action === 'confirm_save' && response.executed && (
                <div className="bg-emerald-600/20 border border-emerald-500/50 rounded-xl px-3 py-2">
                    <p className="text-xs text-emerald-300">✅ Evento salvo na agenda</p>
                </div>
            )}

            {/* Cancel feedback */}
            {response?.action === 'cancel' && (
                <p className="text-xs text-slate-500 italic">Cancelado.</p>
            )}

            {/* Error / unclear */}
            {(response?.action === 'unclear' || response?.action === 'error') && (
                <div className="bg-red-500/10 border border-red-500/40 rounded-xl px-3 py-2 max-w-full">
                    <p className="text-xs text-red-300">{response.speech_response || response.error || 'Não entendi.'}</p>
                </div>
            )}
        </div>
    );
};

export default VoiceCommandButton;

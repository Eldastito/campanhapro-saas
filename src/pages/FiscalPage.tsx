import * as React from 'react';
import { QrCode, LogOut, ScanLine, CheckCircle2, AlertTriangle, MapPin, ShieldCheck, ShieldAlert, Phone, X, Loader2 } from 'lucide-react';
import Header from '../components/Header';
import Card from '../components/ui/Card';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import BUScanner from '../components/election/BUScanner';
import ApuracaoLiveDashboard from '../components/election/ApuracaoLiveDashboard';
import { votosDoCandidato, cargoNomeToCodigo, CARGO_NOMES, BUParsed } from '../lib/buParser';

/**
 * Painel do Fiscal de Urna (Dia D). Mobile-first — o fiscal trabalha no celular
 * dentro da seção. Cobre TODO o kit que ele precisa pra trabalhar em uma zona
 * eleitoral inteira:
 *
 *   1. Alocação: minha zona / minha seção (cadastrada antes do dia D pelo coord).
 *   2. Status TSE: chave Ed25519 da minha UF está cadastrada? (vai do verde ao
 *      amarelo conforme o admin cadastra). Avisa antes de escanear.
 *   3. Escanear BU: a ação principal, já com verificação criptográfica.
 *   4. Reportar incidente: anomalias (urna travada, falta material, fila, etc).
 *   5. Apuração ao vivo: vê os números rolando em tempo real.
 *   6. Meus BUs: histórico do que ele já enviou.
 *   7. Chamar coordenador: link wa.me direto p/ quem é o ponto de contato.
 */
const INCIDENT_TYPES = [
  { id: 'urna_travada', label: '🛑 Urna travada/quebrada', severity: 'high' as const },
  { id: 'fila_longa', label: '🕒 Fila muito longa (>30min)', severity: 'medium' as const },
  { id: 'falta_material', label: '📦 Falta de material', severity: 'medium' as const },
  { id: 'comportamento', label: '⚠️ Comportamento inadequado de mesário', severity: 'high' as const },
  { id: 'boca_urna', label: '🚫 Boca de urna na seção', severity: 'high' as const },
  { id: 'outro', label: '❓ Outro', severity: 'low' as const },
];

const FiscalPage: React.FC = () => {
  const { user, logout } = useAuth();
  const { headerLogo } = useSettings();
  const [scanning, setScanning] = React.useState(false);
  const [candNumber, setCandNumber] = React.useState('');
  const [cargoCodigo, setCargoCodigo] = React.useState<number | null>(null);
  const [meusBUs, setMeusBUs] = React.useState<any[]>([]);
  const [campaignDetails, setCampaignDetails] = React.useState<any>({});
  const [alocacao, setAlocacao] = React.useState<{ uf?: string; municipio?: string; zona?: string; secao?: string; status?: string } | null>(null);
  const [tseKeyStatus, setTseKeyStatus] = React.useState<'loading' | 'ok' | 'missing'>('loading');
  const [incidentOpen, setIncidentOpen] = React.useState(false);

  // Sincroniza candidato + cargo + dados gerais da campanha (telefone do
  // coordenador, UF/município padrão do fiscal se ele não tiver alocação).
  React.useEffect(() => {
    if (!user?.campaignId) return;
    supabase.from('settings').select('campaignDetails').eq('campaignId', user.campaignId).maybeSingle()
      .then(({ data }) => {
        const cd: any = (data as any)?.campaignDetails || {};
        setCampaignDetails(cd);
        setCandNumber(String(cd.numeroUrna || cd.numero || '').trim());
        setCargoCodigo(cargoNomeToCodigo(cd.cargoDisputado || cd.cargo));
      }, () => {});
  }, [user?.campaignId]);

  // Carrega minha alocação (election_fiscais → locations). Se ele ainda não foi
  // alocado, mostra um aviso pra procurar o coordenador.
  React.useEffect(() => {
    if (!user?.campaignId || !user?.id) return;
    (async () => {
      const { data: f } = await supabase.from('election_fiscais')
        .select('id, stationId, status, "checkInTime"')
        .eq('campaignId', user.campaignId)
        .eq('userId', String(user.id))
        .order('createdAt', { ascending: false })
        .maybeSingle();
      if (!f?.stationId) {
        setAlocacao({ status: 'sem_alocacao' });
        return;
      }
      const { data: loc } = await supabase.from('locations')
        .select('name, municipality, state')
        .eq('id', (f as any).stationId).maybeSingle();
      setAlocacao({
        uf: (loc as any)?.state, municipio: (loc as any)?.municipality,
        secao: (loc as any)?.name, status: (f as any).status,
      });
    })();
  }, [user?.campaignId, user?.id]);

  // Status da chave Ed25519 do TSE para a UF dele.
  React.useEffect(() => {
    const uf = (alocacao?.uf || campaignDetails?.uf || '').toUpperCase();
    if (!uf) { setTseKeyStatus('missing'); return; }
    supabase.from('tse_signing_keys').select('uf').eq('uf', uf).maybeSingle()
      .then(({ data }) => setTseKeyStatus(data ? 'ok' : 'missing'));
  }, [alocacao?.uf, campaignDetails?.uf]);

  const loadMeus = React.useCallback(() => {
    if (!user?.campaignId || !user?.id) return;
    supabase.from('boletins_urna')
      .select('id, uf, municipio, zona, secao, votosCandidato, createdAt')
      .eq('campaignId', user.campaignId).eq('fiscalId', String(user.id))
      .order('createdAt', { ascending: false }).limit(50)
      .then(({ data }) => setMeusBUs(data ?? []), () => {});
  }, [user?.campaignId, user?.id]);

  React.useEffect(() => { loadMeus(); }, [loadMeus]);

  const handleBUConfirm = async (bu: BUParsed) => {
    if (!user?.campaignId) throw new Error('Sem campanha vinculada.');
    const res = votosDoCandidato(bu, candNumber, cargoCodigo);
    const cargo = res.cargo;
    const adversarios = cargo ? Object.fromEntries(Object.entries(cargo.candidatos).filter(([n]) => n !== candNumber)) : {};
    const { error } = await supabase.from('boletins_urna').insert({
      campaignId: user.campaignId,
      fiscalId: user.id ? String(user.id) : null,
      rawContent: bu.raw,
      votosCandidato: res.votos,
      votosTotalSecao: cargo?.total ?? bu.header.comparecimento ?? 0,
      votosAdversarios: adversarios,
      hashAuthenticity: bu.hash || null,
      uf: bu.header.uf || null,
      municipio: bu.header.municipio || null,
      zona: bu.header.zona || null,
      secao: bu.header.secao || null,
      cargo: cargo?.codigo ?? cargoCodigo ?? null,
    });
    if (error) throw error;
    loadMeus();
  };

  // Telefone do coordenador (cadastrado nos detalhes da campanha). Se vazio,
  // mostra o botão desabilitado com tooltip.
  const coordPhone = String(campaignDetails?.coordenadorTelefone || campaignDetails?.suporteTelefone || '').replace(/\D+/g, '');
  const waCoord = coordPhone
    ? `https://wa.me/${coordPhone.length <= 11 ? '55' + coordPhone : coordPhone}?text=${encodeURIComponent(`Olá, sou fiscal de urna ${user?.name ?? ''}. Estou na ${alocacao?.secao || 'minha seção'} e preciso de orientação.`)}`
    : null;

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Header logoUrl={headerLogo} />
      <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2"><ScanLine className="w-6 h-6 text-emerald-400" /> Fiscal de Urna</h1>
            <p className="text-slate-400 text-xs sm:text-sm">Olá, {user.name}. Painel do Dia D.</p>
          </div>
          <button onClick={logout} className="text-xs text-slate-400 hover:text-white flex items-center gap-1"><LogOut className="w-4 h-4" /> Sair</button>
        </div>

        {/* Alocação + status TSE em 1 linha (mobile: empilha) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className={`p-3 ${alocacao?.status === 'sem_alocacao' ? 'border-amber-500/30 bg-amber-500/5' : ''}`}>
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-sky-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Minha alocação</p>
                {alocacao?.status === 'sem_alocacao' ? (
                  <p className="text-amber-300 text-sm font-bold">Não alocado ainda — procure seu coordenador.</p>
                ) : alocacao ? (
                  <>
                    <p className="text-white font-bold text-sm truncate">{alocacao.secao || 'Seção'}</p>
                    <p className="text-[11px] text-slate-400">{alocacao.municipio || ''} {alocacao.uf ? `· ${alocacao.uf}` : ''}{alocacao.status === 'present' || alocacao.status === 'checked_in' ? ' · ✅ Check-in feito' : ''}</p>
                  </>
                ) : (
                  <p className="text-slate-500 text-xs">Carregando…</p>
                )}
              </div>
            </div>
          </Card>

          <Card className={`p-3 ${tseKeyStatus === 'missing' ? 'border-amber-500/30 bg-amber-500/5' : tseKeyStatus === 'ok' ? 'border-emerald-500/30 bg-emerald-500/5' : ''}`}>
            <div className="flex items-start gap-3">
              {tseKeyStatus === 'ok' ? <ShieldCheck className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
                : tseKeyStatus === 'missing' ? <ShieldAlert className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                : <Loader2 className="w-5 h-5 text-slate-400 mt-0.5 shrink-0 animate-spin" />}
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Verificação criptográfica</p>
                <p className="text-white font-bold text-sm">
                  {tseKeyStatus === 'ok' ? 'Chave TSE disponível' : tseKeyStatus === 'missing' ? 'Chave TSE pendente' : 'Carregando…'}
                </p>
                <p className="text-[11px] text-slate-400">
                  {tseKeyStatus === 'ok' ? 'Cada BU vai ser autenticado contra a chave Ed25519 oficial.'
                    : 'O TSE só publica após a Cerimônia de Lacração. Apuração funciona; só não terá verificação cripto.'}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Ação principal — Escanear BU */}
        <Card className="bg-slate-800 p-5 sm:p-6 text-center">
          <p className="text-slate-300 text-sm mb-3">Pronto pra apurar? Aponte a câmera para os QR Codes do Boletim de Urna.</p>
          <button onClick={() => setScanning(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 sm:px-8 py-3 sm:py-4 rounded-2xl font-black text-base sm:text-lg inline-flex items-center gap-3">
            <QrCode className="w-6 h-6" /> Escanear BU
          </button>
          <p className="text-[11px] text-slate-500 mt-2">Você já enviou <b className="text-emerald-400">{meusBUs.length}</b> boletim(ns).</p>
        </Card>

        {/* Linha de ações rápidas: incidente + coordenador */}
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setIncidentOpen(true)}
            className="bg-rose-600/15 hover:bg-rose-600/25 border border-rose-500/30 text-rose-300 rounded-xl p-3 flex flex-col items-center gap-1.5 transition-colors">
            <AlertTriangle className="w-5 h-5" />
            <span className="text-xs font-bold">Reportar incidente</span>
          </button>
          <a href={waCoord || '#'} target={waCoord ? '_blank' : undefined} rel="noopener noreferrer"
            className={`rounded-xl p-3 flex flex-col items-center gap-1.5 border transition-colors ${waCoord ? 'bg-emerald-600/15 hover:bg-emerald-600/25 border-emerald-500/30 text-emerald-300' : 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'}`}
            onClick={waCoord ? undefined : (e) => e.preventDefault()}
            title={waCoord ? 'Abrir WhatsApp do coordenador' : 'Sem telefone do coordenador cadastrado'}>
            <Phone className="w-5 h-5" />
            <span className="text-xs font-bold">Chamar coordenador</span>
          </a>
        </div>

        {/* Apuração ao vivo */}
        <ApuracaoLiveDashboard />

        {/* Meus BUs */}
        <Card className="bg-slate-800 p-4">
          <h2 className="text-base font-bold mb-3">Meus boletins escaneados</h2>
          {meusBUs.length === 0 ? (
            <p className="text-slate-400 text-xs">Nenhum BU escaneado ainda.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {meusBUs.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 bg-slate-900/50 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="truncate">{b.uf || '—'} · Zona {b.zona || '—'} · Seção {b.secao || '—'}{b.cargo ? ` · ${CARGO_NOMES[b.cargo] || ''}` : ''}</span>
                  </div>
                  <span className="font-bold text-emerald-400 shrink-0">{b.votosCandidato} votos</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>

      <BUScanner open={scanning} onClose={() => setScanning(false)} candidateNumber={candNumber} cargoCodigo={cargoCodigo} onConfirm={handleBUConfirm} />

      {incidentOpen && (
        <IncidentReportModal
          onClose={() => setIncidentOpen(false)}
          campaignId={user.campaignId || ''}
          fiscalId={user.id ? String(user.id) : ''}
          locationId={null}
        />
      )}
    </div>
  );
};

/** Modal compacto pra registrar incidente no Dia D. Insert em election_incidents. */
const IncidentReportModal: React.FC<{ onClose: () => void; campaignId: string; fiscalId: string; locationId: string | null }> = ({ onClose, campaignId, fiscalId }) => {
  const [type, setType] = React.useState(INCIDENT_TYPES[0].id);
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const submit = async () => {
    if (!description.trim()) return;
    setBusy(true);
    const meta = INCIDENT_TYPES.find((t) => t.id === type) ?? INCIDENT_TYPES[INCIDENT_TYPES.length - 1];
    const { error } = await supabase.from('election_incidents').insert({
      campaignId, fiscalId, type, severity: meta.severity, status: 'open',
      description: description.trim().slice(0, 1000),
    });
    setBusy(false);
    if (error) { alert('Erro ao registrar: ' + error.message); return; }
    onClose();
    alert('✅ Incidente registrado. O coordenador vai ser notificado.');
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-3 sm:p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-white/10 rounded-2xl max-w-md w-full p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-white text-base flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-rose-400" /> Reportar incidente</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-slate-500">Tipo</label>
          <select value={type} onChange={(e) => setType(e.target.value)}
            className="w-full mt-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
            {INCIDENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider text-slate-500">Descrição</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            placeholder="Descreva o que aconteceu (zona/seção, horário aproximado, evidências)…"
            className="w-full mt-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" />
          <p className="text-[10px] text-slate-500 mt-1">Será encaminhado ao coordenador. Inclua detalhes objetivos.</p>
        </div>
        <button onClick={submit} disabled={busy || !description.trim()}
          className="w-full bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white text-sm font-bold py-2.5 rounded-xl">
          {busy ? 'Enviando…' : 'Registrar incidente'}
        </button>
      </div>
    </div>
  );
};

export default FiscalPage;

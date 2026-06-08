import * as React from 'react';
import { QrCode, LogOut, ScanLine, CheckCircle2 } from 'lucide-react';
import Header from '../components/Header';
import Card from '../components/ui/Card';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import BUScanner from '../components/election/BUScanner';
import ApuracaoLiveDashboard from '../components/election/ApuracaoLiveDashboard';
import { votosDoCandidato, cargoNomeToCodigo, CARGO_NOMES, BUParsed } from '../lib/buParser';

/**
 * Painel do Fiscal de Zona Eleitoral (Dia D). Escaneia os QR Codes do Boletim de
 * Urna e envia para a apuração paralela em tempo real. Mostra a apuração ao vivo
 * para acompanhamento.
 */
const FiscalPage: React.FC = () => {
  const { user, logout } = useAuth();
  const { headerLogo } = useSettings();
  const [scanning, setScanning] = React.useState(false);
  const [candNumber, setCandNumber] = React.useState('');
  const [cargoCodigo, setCargoCodigo] = React.useState<number | null>(null);
  const [meusBUs, setMeusBUs] = React.useState<any[]>([]);

  React.useEffect(() => {
    if (!user?.campaignId) return;
    supabase.from('settings').select('campaignDetails').eq('campaignId', user.campaignId).maybeSingle()
      .then(({ data }) => {
        const cd: any = (data as any)?.campaignDetails || {};
        setCandNumber(String(cd.numeroUrna || cd.numero || '').trim());
        setCargoCodigo(cargoNomeToCodigo(cd.cargoDisputado || cd.cargo));
      }, () => {});
  }, [user?.campaignId]);

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

  if (!user) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Header logoUrl={headerLogo} />
      <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><ScanLine className="w-6 h-6 text-emerald-400" /> Fiscal de Zona Eleitoral</h1>
            <p className="text-slate-400 text-sm">Olá, {user.name}. Escaneie os BUs e alimente a apuração em tempo real.</p>
          </div>
          <button onClick={logout} className="text-sm text-slate-400 hover:text-white flex items-center gap-1"><LogOut className="w-4 h-4" /> Sair</button>
        </div>

        <Card className="bg-slate-800 p-6 text-center">
          <p className="text-slate-300 mb-4">Pronto para apurar? Aponte a câmera para os QR Codes do Boletim de Urna.</p>
          <button onClick={() => setScanning(true)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-8 py-4 rounded-2xl font-black text-lg inline-flex items-center gap-3">
            <QrCode className="w-6 h-6" /> Escanear BU
          </button>
          <p className="text-[11px] text-slate-500 mt-3">Você já enviou <b className="text-emerald-400">{meusBUs.length}</b> boletim(ns).</p>
        </Card>

        {/* Apuração ao vivo */}
        <ApuracaoLiveDashboard />

        {/* Meus BUs */}
        <Card className="bg-slate-800 p-4">
          <h2 className="text-lg font-bold mb-3">Meus boletins escaneados</h2>
          {meusBUs.length === 0 ? (
            <p className="text-slate-400 text-sm">Nenhum BU escaneado ainda.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {meusBUs.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 bg-slate-900/50 rounded-lg p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>{b.uf || '—'} · Zona {b.zona || '—'} · Seção {b.secao || '—'}{b.cargo ? ` · ${CARGO_NOMES[b.cargo] || ''}` : ''}</span>
                  </div>
                  <span className="font-bold text-emerald-400">{b.votosCandidato} votos</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>

      <BUScanner open={scanning} onClose={() => setScanning(false)} candidateNumber={candNumber} cargoCodigo={cargoCodigo} onConfirm={handleBUConfirm} />
    </div>
  );
};

export default FiscalPage;

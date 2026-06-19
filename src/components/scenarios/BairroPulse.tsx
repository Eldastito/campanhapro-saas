import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import { Radar, Plus, Trash2, RefreshCw, MessageSquare, AlertTriangle, Instagram, Loader2 } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

interface WatchItem { id: string; username: string; label: string | null; bairro: string | null; lastSnapshot?: any }
interface IgPost { caption: string; likeCount: number; commentsCount: number; permalink: string; timestamp: string }
interface PulsePage { username: string; label: string | null; bairro: string | null; discovery?: { followersCount: number; posts: IgPost[] }; error?: string }

// Render leve de markdown (negrito, listas, links).
const Md: React.FC<{ text: string }> = ({ text }) => (
  <div className="space-y-1 text-[12px] text-slate-300">
    {text.split('\n').map((line, i) => {
      const tl = line.trim();
      if (!tl) return <div key={i} className="h-1" />;
      const html = tl
        .replace(/\*\*(.+?)\*\*/g, '<strong class="text-slate-100">$1</strong>')
        .replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noreferrer" class="text-indigo-400 underline">link</a>');
      if (/^#{1,6}\s/.test(tl)) return <p key={i} className="text-slate-100 font-bold mt-1.5" dangerouslySetInnerHTML={{ __html: html.replace(/^#{1,6}\s/, '') }} />;
      if (/^[-*]\s/.test(tl)) return <p key={i} className="pl-3 text-slate-400" dangerouslySetInnerHTML={{ __html: '• ' + html.replace(/^[-*]\s/, '') }} />;
      return <p key={i} dangerouslySetInnerHTML={{ __html: html }} />;
    })}
  </div>
);

export const BairroPulse: React.FC = () => {
  const [connected, setConnected] = React.useState<boolean | null>(null);
  const [igUsername, setIgUsername] = React.useState<string | null>(null);
  const [watch, setWatch] = React.useState<WatchItem[]>([]);
  const [newUser, setNewUser] = React.useState('');
  const [newBairro, setNewBairro] = React.useState('');
  const [pulse, setPulse] = React.useState<{ pages: PulsePage[]; temas: string } | null>(null);
  const [own, setOwn] = React.useState<{ media: any[]; totalComments: number; analysis: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadStatus = React.useCallback(async () => {
    try {
      const [s, w] = await Promise.all([
        authedFetch('/api/v1/social/instagram/status').then(r => r.json()),
        authedFetch('/api/v1/social/watchlist').then(r => r.json()),
      ]);
      setConnected(!!s.connected); setIgUsername(s.username ?? null);
      setWatch(w.watchlist ?? []);
    } catch { setConnected(false); }
  }, []);

  React.useEffect(() => { loadStatus(); }, [loadStatus]);

  const addWatch = async () => {
    const u = newUser.replace(/^@/, '').trim();
    if (!u) return;
    setBusy('add'); setError(null);
    try {
      const res = await authedFetch('/api/v1/social/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, label: newBairro || u, bairro: newBairro || null }) });
      if (!res.ok) throw new Error((await res.json()).error || 'Erro');
      setNewUser(''); setNewBairro(''); await loadStatus();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const delWatch = async (id: string) => {
    await authedFetch(`/api/v1/social/watchlist/${id}`, { method: 'DELETE' });
    setWatch(w => w.filter(x => x.id !== id));
  };

  const runPulse = async () => {
    setBusy('pulse'); setError(null); setPulse(null);
    try {
      const res = await authedFetch('/api/v1/social/instagram/pulse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || 'Erro no pulso');
      setPulse(j);
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const loadOwn = async () => {
    setBusy('own'); setError(null); setOwn(null);
    try {
      const res = await authedFetch('/api/v1/social/instagram/own-comments');
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail || j.error || 'Erro ao ler comentários');
      setOwn(j);
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Radar className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-semibold text-slate-300">Pulso dos Bairros</h3>
        </div>
        <p className="text-xs text-slate-400 mb-3">
          Acompanhe as páginas de bairro (ex.: <em>"A voz da comunidade"</em>) via API oficial do Instagram.
          Vemos <strong className="text-slate-200">quais posts bombam e o tema</strong> de cada bairro (legenda + nº de comentários).
          O <strong className="text-slate-200">texto</strong> dos comentários de páginas de terceiros a Meta não libera —
          isso só nos posts do próprio candidato (aba abaixo).
        </p>

        {connected === false && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300">
            <p className="mb-1 flex items-center gap-1.5"><Instagram className="w-3.5 h-3.5" /> Instagram do candidato não conectado.</p>
            <p className="text-amber-400/80 text-[11px]">
              Conecte em <strong>Agentes IA → aba "Conexões"</strong> (conta IG Business/Creator).
              Assim que estiver lá, o Pulso e os comentários funcionam aqui automaticamente.
            </p>
          </div>
        )}
        {connected && (
          <p className="text-[11px] text-emerald-400 mb-3">✓ Instagram conectado{igUsername ? ` (@${igUsername})` : ''}.</p>
        )}

        {connected && (
          <>
            <div className="flex flex-wrap items-end gap-2 mb-3">
              <div className="flex flex-col">
                <label className="text-[10px] text-slate-500 mb-0.5">@ da página</label>
                <input className="text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 w-40 focus:outline-none focus:border-indigo-500"
                  placeholder="vozdacomunidade" value={newUser} onChange={e => setNewUser(e.target.value)} />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-slate-500 mb-0.5">Bairro</label>
                <input className="text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 w-36 focus:outline-none focus:border-indigo-500"
                  placeholder="Centro" value={newBairro} onChange={e => setNewBairro(e.target.value)} />
              </div>
              <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={addWatch} disabled={busy === 'add' || !newUser.trim()}>
                <Plus className="w-3 h-3 mr-1" /> Adicionar
              </Button>
              <Button variant="primary" className="text-xs px-3 py-1.5 ml-auto" onClick={runPulse} disabled={busy === 'pulse' || watch.length === 0}>
                {busy === 'pulse' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                Rodar pulso
              </Button>
            </div>

            {watch.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {watch.map(w => (
                  <span key={w.id} className="inline-flex items-center gap-1.5 bg-slate-700/60 border border-slate-600 rounded-full px-2.5 py-1 text-[11px] text-slate-300">
                    <Instagram className="w-3 h-3 text-pink-400" />
                    {w.bairro ? `${w.bairro}: ` : ''}@{w.username}
                    <button onClick={() => delWatch(w.id)} className="text-slate-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
            )}
            {watch.length === 0 && <p className="text-[11px] text-slate-500">Adicione páginas de bairro pra começar.</p>}
          </>
        )}

        {error && <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 mt-2">{error}</p>}
      </Card>

      {pulse && (
        <Card>
          <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><Radar className="w-4 h-4 text-indigo-400" /> Temas quentes por bairro</h3>
          {pulse.temas ? <Md text={pulse.temas} /> : <p className="text-xs text-slate-500">A IA não retornou análise — veja os posts crus abaixo.</p>}
          <div className="mt-4 pt-3 border-t border-slate-700 space-y-3">
            {pulse.pages.map((p, i) => (
              <div key={i} className="text-xs">
                <p className="font-medium text-slate-300">{p.bairro ? `${p.bairro} — ` : ''}@{p.username}
                  {p.discovery && <span className="text-slate-500"> · {p.discovery.followersCount.toLocaleString('pt-BR')} seguidores</span>}
                </p>
                {p.error && <p className="text-amber-400/80 text-[11px]">⚠ {p.error}</p>}
                {p.discovery && [...p.discovery.posts].sort((a, b) => b.commentsCount - a.commentsCount).slice(0, 3).map((post, j) => (
                  <a key={j} href={post.permalink} target="_blank" rel="noreferrer" className="block pl-3 text-slate-400 hover:text-indigo-300 truncate">
                    💬 {post.commentsCount} · {(post.caption || '(sem legenda)').slice(0, 90)}
                  </a>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      {connected && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2"><MessageSquare className="w-4 h-4 text-emerald-400" /> Comentários no perfil do candidato</h3>
            <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={loadOwn} disabled={busy === 'own'}>
              {busy === 'own' ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
              Analisar
            </Button>
          </div>
          <p className="text-[11px] text-slate-500 mb-2">Aqui a API libera o texto completo — sentimento e dores da audiência do próprio candidato.</p>
          {own && (
            <>
              <p className="text-[11px] text-slate-400 mb-2">{own.totalComments} comentários lidos em {own.media.length} posts.</p>
              {own.analysis ? <Md text={own.analysis} /> : <p className="text-xs text-slate-500">Sem comentários suficientes pra analisar.</p>}
            </>
          )}
        </Card>
      )}

      <p className="text-[10px] text-slate-600 flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" /> Dados públicos via API oficial da Meta. Insumo interno — não divulgar como pesquisa.
      </p>
    </div>
  );
};

export default BairroPulse;

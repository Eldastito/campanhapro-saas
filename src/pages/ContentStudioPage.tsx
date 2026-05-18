import * as React from 'react';
import { authedFetch } from '../lib/authedFetch';
import {
  Sparkles, Copy, Trash2, Send, Calendar as CalendarIcon, CheckCircle2,
  AlertTriangle, Plus, Loader2, Instagram, MessageCircle, Facebook, Twitter,
  Video, Globe, RefreshCcw,
} from 'lucide-react';

// -------------------- Types --------------------
type Channel = 'instagram' | 'tiktok' | 'whatsapp' | 'facebook' | 'twitter' | 'generic';
type PostType = 'post' | 'story' | 'reel' | 'blast' | 'thread';
type Tone = 'formal' | 'neutro' | 'popular' | 'jovem' | 'combativo';
type Status = 'draft' | 'approved' | 'scheduled' | 'published' | 'archived';
type LengthHint = 'curto' | 'medio' | 'longo';

interface ComplianceFlag { rule: string; severity: 'warn' | 'error'; message: string; }
interface PostRow {
  id: string;
  channel: Channel;
  postType: PostType;
  tone?: Tone | null;
  topic?: string | null;
  finalText?: string | null;
  generatedText?: string | null;
  brief?: string | null;
  hashtags?: string[] | null;
  imageUrl?: string | null;
  complianceFlags?: ComplianceFlag[] | null;
  status: Status;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

const CHANNELS: Channel[] = ['instagram', 'tiktok', 'whatsapp', 'facebook', 'twitter', 'generic'];
const POST_TYPES: PostType[] = ['post', 'story', 'reel', 'blast', 'thread'];
const TONES: Tone[] = ['neutro', 'popular', 'formal', 'jovem', 'combativo'];
const LENGTHS: LengthHint[] = ['curto', 'medio', 'longo'];

const CHANNEL_META: Record<Channel, { label: string; icon: React.ReactNode; color: string }> = {
  instagram: { label: 'Instagram', icon: <Instagram className="h-4 w-4" />, color: 'bg-pink-500/15 text-pink-300 border-pink-500/30' },
  tiktok:    { label: 'TikTok',    icon: <Video className="h-4 w-4" />,     color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' },
  whatsapp:  { label: 'WhatsApp',  icon: <MessageCircle className="h-4 w-4" />, color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  facebook:  { label: 'Facebook',  icon: <Facebook className="h-4 w-4" />,  color: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  twitter:   { label: 'X / Twitter', icon: <Twitter className="h-4 w-4" />, color: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  generic:   { label: 'Genérico',  icon: <Globe className="h-4 w-4" />,     color: 'bg-violet-500/15 text-violet-300 border-violet-500/30' },
};

const STATUS_META: Record<Status, { label: string; color: string }> = {
  draft:     { label: 'Rascunho',  color: 'bg-slate-700 text-slate-300' },
  approved:  { label: 'Aprovado',  color: 'bg-amber-500/20 text-amber-300' },
  scheduled: { label: 'Agendado',  color: 'bg-sky-500/20 text-sky-300' },
  published: { label: 'Publicado', color: 'bg-emerald-500/20 text-emerald-300' },
  archived:  { label: 'Arquivado', color: 'bg-slate-800 text-slate-500' },
};

// -------------------- Page --------------------
const ContentStudioPage: React.FC = () => {
  const [posts, setPosts] = React.useState<PostRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [filter, setFilter] = React.useState<Status | 'all'>('all');
  const [selected, setSelected] = React.useState<PostRow | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadPosts = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = filter === 'all' ? '' : `?status=${filter}`;
      const res = await authedFetch(`/api/v1/content${q}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setPosts(json.posts ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  React.useEffect(() => { loadPosts(); }, [loadPosts]);

  const handleCreated = (post: PostRow) => {
    setPosts(p => [post, ...p]);
    setSelected(post);
    setShowCreate(false);
  };

  const handleUpdated = (post: PostRow) => {
    setPosts(p => p.map(x => x.id === post.id ? post : x));
    setSelected(post);
  };

  const handleDeleted = (id: string) => {
    setPosts(p => p.filter(x => x.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-violet-400" />
            Estúdio de Conteúdo
          </h2>
          <p className="text-sm text-slate-400 mt-1">Gere posts com IA, valide compliance TSE e agende publicações.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadPosts}
            className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            title="Recarregar"
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium"
          >
            <Plus className="h-4 w-4" /> Novo Post
          </button>
        </div>
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'draft', 'approved', 'scheduled', 'published'] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              filter === s
                ? 'bg-violet-600 text-white border-violet-500'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
          >
            {s === 'all' ? 'Todos' : STATUS_META[s].label}
          </button>
        ))}
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* List */}
        <div className="lg:col-span-2 space-y-2 max-h-[70vh] overflow-y-auto pr-1">
          {loading && (
            <div className="flex items-center gap-2 text-slate-400 p-4">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando posts…
            </div>
          )}
          {!loading && posts.length === 0 && (
            <div className="p-6 text-center bg-slate-900/40 border border-dashed border-slate-700 rounded-xl text-slate-400 text-sm">
              Nenhum post {filter !== 'all' ? `com status "${STATUS_META[filter as Status].label.toLowerCase()}"` : 'criado'} ainda.
              <br />
              Clique em <strong className="text-violet-300">Novo Post</strong> para começar.
            </div>
          )}
          {posts.map(p => (
            <PostListItem
              key={p.id}
              post={p}
              active={selected?.id === p.id}
              onClick={() => setSelected(p)}
            />
          ))}
        </div>

        {/* Detail */}
        <div className="lg:col-span-3">
          {selected ? (
            <PostDetailPanel
              post={selected}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
            />
          ) : (
            <div className="p-8 text-center bg-slate-900/40 border border-dashed border-slate-700 rounded-xl text-slate-400 text-sm">
              Selecione um post à esquerda para editar, ou crie um novo.
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <CreatePostModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
};

// -------------------- List Item --------------------
const PostListItem: React.FC<{ post: PostRow; active: boolean; onClick: () => void }> = ({ post, active, onClick }) => {
  const cm = CHANNEL_META[post.channel] ?? CHANNEL_META.generic;
  const sm = STATUS_META[post.status];
  const preview = (post.finalText ?? post.generatedText ?? post.brief ?? '').slice(0, 120);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg border transition ${
        active
          ? 'bg-slate-800 border-violet-500/60'
          : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs border ${cm.color}`}>
          {cm.icon} {cm.label}
        </span>
        <span className={`px-2 py-0.5 rounded-md text-[10px] uppercase font-bold ${sm.color}`}>
          {sm.label}
        </span>
      </div>
      <div className="text-sm font-medium text-slate-200 truncate">
        {post.topic || preview.slice(0, 60) || '(sem título)'}
      </div>
      {preview && (
        <div className="text-xs text-slate-500 mt-1 line-clamp-2">{preview}…</div>
      )}
      {post.scheduledAt && post.status === 'scheduled' && (
        <div className="text-[11px] text-sky-400 mt-1.5 inline-flex items-center gap-1">
          <CalendarIcon className="h-3 w-3" /> {new Date(post.scheduledAt).toLocaleString('pt-BR')}
        </div>
      )}
    </button>
  );
};

// -------------------- Detail Panel --------------------
const PostDetailPanel: React.FC<{
  post: PostRow;
  onUpdated: (p: PostRow) => void;
  onDeleted: (id: string) => void;
}> = ({ post, onUpdated, onDeleted }) => {
  const [text, setText] = React.useState(post.finalText ?? post.generatedText ?? '');
  const [hashtags, setHashtags] = React.useState((post.hashtags ?? []).join(' '));
  const [imageUrl, setImageUrl] = React.useState(post.imageUrl ?? '');
  const [saving, setSaving] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = React.useState('');
  const [showSchedule, setShowSchedule] = React.useState(false);

  React.useEffect(() => {
    setText(post.finalText ?? post.generatedText ?? '');
    setHashtags((post.hashtags ?? []).join(' '));
    setImageUrl(post.imageUrl ?? '');
    setShowSchedule(false);
  }, [post.id]);

  const cm = CHANNEL_META[post.channel] ?? CHANNEL_META.generic;
  const sm = STATUS_META[post.status];

  const save = async () => {
    setSaving(true);
    try {
      const tags = hashtags.split(/[\s,]+/).filter(Boolean).map(t => t.startsWith('#') ? t : `#${t}`);
      const res = await authedFetch(`/api/v1/content/${post.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalText: text, hashtags: tags, imageUrl: imageUrl || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      onUpdated(json.post);
    } catch (e: any) {
      alert(`Erro ao salvar: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const callAction = async (path: string, body?: any, successLabel = 'OK') => {
    setBusy(path);
    try {
      const res = await authedFetch(`/api/v1/content/${post.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // re-fetch full
      const fresh = await authedFetch(`/api/v1/content/${post.id}`);
      const fjson = await fresh.json();
      onUpdated(fjson.post);
      return json;
    } catch (e: any) {
      alert(`Erro: ${e.message}`);
    } finally {
      setBusy(null);
    }
  };

  const copyToClipboard = async () => {
    const tagsStr = (post.hashtags ?? []).join(' ');
    const out = tagsStr ? `${text}\n\n${tagsStr}` : text;
    await navigator.clipboard.writeText(out);
    alert('Copiado para a área de transferência!');
  };

  const handleDelete = async () => {
    if (!confirm('Excluir este post? Esta ação não pode ser desfeita.')) return;
    try {
      const res = await authedFetch(`/api/v1/content/${post.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDeleted(post.id);
    } catch (e: any) {
      alert(`Erro ao excluir: ${e.message}`);
    }
  };

  const charCount = text.length;
  const channelLimit = post.channel === 'twitter' ? 280
    : post.channel === 'whatsapp' ? 1024
    : post.channel === 'instagram' ? 2200
    : post.channel === 'facebook' ? 5000
    : 5000;
  const overLimit = charCount > channelLimit;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs border ${cm.color}`}>
              {cm.icon} {cm.label}
            </span>
            <span className="text-xs text-slate-500">·</span>
            <span className="text-xs text-slate-400">{post.postType}</span>
            {post.tone && (
              <>
                <span className="text-xs text-slate-500">·</span>
                <span className="text-xs text-slate-400">{post.tone}</span>
              </>
            )}
            <span className={`px-2 py-0.5 rounded-md text-[10px] uppercase font-bold ${sm.color}`}>
              {sm.label}
            </span>
          </div>
          <h3 className="text-lg font-semibold text-slate-100">{post.topic || '(sem título)'}</h3>
        </div>
        <button
          onClick={handleDelete}
          className="p-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30"
          title="Excluir"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Text editor */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-slate-400">Texto final</label>
          <span className={`text-[11px] ${overLimit ? 'text-red-400' : 'text-slate-500'}`}>
            {charCount} / {channelLimit}
          </span>
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={10}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 resize-y leading-relaxed"
          placeholder="Edite o texto final do post…"
        />
      </div>

      {/* Hashtags */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">Hashtags (separadas por espaço)</label>
        <input
          value={hashtags}
          onChange={e => setHashtags(e.target.value)}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
          placeholder="#campanha #SuaCidade #Votarinha"
        />
      </div>

      {/* Image */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-slate-400">URL da imagem (opcional)</label>
        <input
          value={imageUrl}
          onChange={e => setImageUrl(e.target.value)}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
          placeholder="https://…"
        />
        {imageUrl && (
          <img src={imageUrl} alt="" className="mt-2 max-h-48 rounded-lg border border-slate-700" />
        )}
      </div>

      {/* Compliance flags */}
      {post.complianceFlags && post.complianceFlags.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-400">Compliance TSE</label>
          <div className="space-y-1.5">
            {post.complianceFlags.map((f, i) => (
              <div
                key={i}
                className={`flex items-start gap-2 p-2.5 rounded-lg border text-xs ${
                  f.severity === 'error'
                    ? 'bg-red-500/10 border-red-500/30 text-red-300'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                }`}
              >
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-mono text-[10px] opacity-70">{f.rule}</div>
                  <div className="mt-0.5">{f.message}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm font-medium disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          Salvar
        </button>
        <button
          onClick={copyToClipboard}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
        >
          <Copy className="h-4 w-4" /> Copiar
        </button>
        {post.status === 'draft' && (
          <button
            onClick={() => callAction('approve')}
            disabled={busy === 'approve'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Aprovar
          </button>
        )}
        {(post.status === 'approved' || post.status === 'draft') && (
          <>
            <button
              onClick={() => setShowSchedule(s => !s)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium"
            >
              <CalendarIcon className="h-4 w-4" /> Agendar
            </button>
            <button
              onClick={() => callAction('publish')}
              disabled={busy === 'publish'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
            >
              {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Marcar publicado
            </button>
          </>
        )}
      </div>

      {showSchedule && (
        <div className="flex items-end gap-2 p-3 bg-slate-950/50 border border-slate-800 rounded-lg">
          <div className="flex-1">
            <label className="text-xs font-medium text-slate-400">Agendar para</label>
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={e => setScheduleAt(e.target.value)}
              className="mt-1 w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
            />
          </div>
          <button
            onClick={async () => {
              if (!scheduleAt) return;
              const iso = new Date(scheduleAt).toISOString();
              await callAction('schedule', { scheduledAt: iso });
              setShowSchedule(false);
            }}
            disabled={!scheduleAt || busy === 'schedule'}
            className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium disabled:opacity-50"
          >
            Confirmar
          </button>
        </div>
      )}
    </div>
  );
};

// -------------------- Create Modal --------------------
const CreatePostModal: React.FC<{
  onClose: () => void;
  onCreated: (post: PostRow) => void;
}> = ({ onClose, onCreated }) => {
  const [channel, setChannel] = React.useState<Channel>('instagram');
  const [postType, setPostType] = React.useState<PostType>('post');
  const [tone, setTone] = React.useState<Tone>('neutro');
  const [topic, setTopic] = React.useState('');
  const [lengthHint, setLengthHint] = React.useState<LengthHint>('medio');
  const [generating, setGenerating] = React.useState(false);
  const [generated, setGenerated] = React.useState<{
    text: string;
    hashtags: string[];
    callToAction: string;
    complianceFlags: ComplianceFlag[];
  } | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const generate = async () => {
    if (!topic.trim()) {
      setErr('Informe o tópico.');
      return;
    }
    setErr(null);
    setGenerating(true);
    try {
      const res = await authedFetch('/api/v1/content/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, postType, tone, topic, lengthHint }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setGenerated({
        text: json.text,
        hashtags: json.hashtags ?? [],
        callToAction: json.callToAction ?? '',
        complianceFlags: json.complianceFlags ?? [],
      });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setGenerating(false);
    }
  };

  const saveDraft = async () => {
    setSaving(true);
    try {
      const res = await authedFetch('/api/v1/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          postType,
          tone,
          topic,
          brief: topic,
          generatedText: generated?.text ?? null,
          finalText: generated?.text ?? null,
          hashtags: generated?.hashtags ?? null,
          complianceFlags: generated?.complianceFlags ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      onCreated(json.post);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
          <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-violet-400" /> Novo Post com IA
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 text-2xl leading-none">&times;</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Channel */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Canal</label>
            <div className="grid grid-cols-3 gap-2">
              {CHANNELS.map(c => {
                const m = CHANNEL_META[c];
                return (
                  <button
                    key={c}
                    onClick={() => setChannel(c)}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition ${
                      channel === c
                        ? `${m.color} ring-2 ring-violet-500/40`
                        : 'bg-slate-950 border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {m.icon} {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* PostType + Tone */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Tipo</label>
              <select
                value={postType}
                onChange={e => setPostType(e.target.value as PostType)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-violet-500"
              >
                {POST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Tom</label>
              <select
                value={tone}
                onChange={e => setTone(e.target.value as Tone)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-violet-500"
              >
                {TONES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Length */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Tamanho</label>
            <div className="flex gap-2">
              {LENGTHS.map(l => (
                <button
                  key={l}
                  onClick={() => setLengthHint(l)}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-sm capitalize border ${
                    lengthHint === l
                      ? 'bg-violet-600 text-white border-violet-500'
                      : 'bg-slate-950 text-slate-400 border-slate-700 hover:border-slate-600'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Topic */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400">Tópico / briefing</label>
            <textarea
              value={topic}
              onChange={e => setTopic(e.target.value)}
              rows={3}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-violet-500 resize-y"
              placeholder="Ex: anunciar inauguração da nova UBS no bairro Jardim das Flores; agradecer apoiadores"
            />
          </div>

          {/* Generate button */}
          <button
            onClick={generate}
            disabled={generating || !topic.trim()}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {generating ? 'Gerando…' : (generated ? 'Regenerar com IA' : 'Gerar com IA')}
          </button>

          {err && (
            <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">
              {err}
            </div>
          )}

          {/* Generated preview */}
          {generated && (
            <div className="space-y-3 p-3 bg-slate-950/60 border border-slate-800 rounded-lg">
              <div>
                <div className="text-xs font-medium text-slate-400 mb-1">Texto gerado</div>
                <div className="whitespace-pre-wrap text-sm text-slate-100 leading-relaxed">
                  {generated.text}
                </div>
              </div>
              {generated.hashtags.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-slate-400 mb-1">Hashtags sugeridas</div>
                  <div className="text-sm text-violet-300">{generated.hashtags.join(' ')}</div>
                </div>
              )}
              {generated.callToAction && (
                <div>
                  <div className="text-xs font-medium text-slate-400 mb-1">Chamada para ação</div>
                  <div className="text-sm text-slate-200">{generated.callToAction}</div>
                </div>
              )}
              {generated.complianceFlags.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-slate-400">Alertas de compliance</div>
                  {generated.complianceFlags.map((f, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 p-2 rounded text-xs ${
                        f.severity === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-amber-500/10 text-amber-300'
                      }`}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      <span>{f.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-slate-800 sticky bottom-0 bg-slate-900">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm"
          >
            Cancelar
          </button>
          <button
            onClick={saveDraft}
            disabled={saving || !topic.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Salvar como rascunho
          </button>
        </div>
      </div>
    </div>
  );
};

export default ContentStudioPage;

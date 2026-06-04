import * as React from 'react';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { Copy, Trash2, ExternalLink, RefreshCw, Calendar, BarChart3, Plus } from 'lucide-react';

/**
 * Short-links admin page. Lets Admin/Suporte create, list, and delete
 * short URLs for the current campaign.
 *
 * URL shape served by the backend:
 *   https://<host>/l/<slug>   →  302  →  target_url
 *
 * We don't render the public origin from the client (we let the browser's
 * `window.location.origin` resolve it), so links work locally and in prod
 * without env-var plumbing.
 */

interface ShortLink {
  id: string;
  slug: string;
  target_url: string;
  title: string | null;
  expiresAt: string | null;
  clicks: number;
  lastClickAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const API_BASE = '/api/v1/short-links';

async function fetchLinks(): Promise<ShortLink[]> {
  const res = await fetch(API_BASE, { credentials: 'include' });
  if (!res.ok) throw new Error(`fetch_links_${res.status}`);
  const j = await res.json();
  return j.links ?? [];
}

async function createLink(payload: {
  slug?: string;
  target_url: string;
  title?: string;
  expiresAt?: string | null;
}): Promise<ShortLink> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error ?? `create_failed_${res.status}`);
  return j.link;
}

async function deleteLink(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!res.ok && res.status !== 204) throw new Error(`delete_failed_${res.status}`);
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

const ShortLinksPage: React.FC = () => {
  const [links, setLinks] = React.useState<ShortLink[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // Create-form state
  const [targetUrl, setTargetUrl] = React.useState('');
  const [slug, setSlug] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [expiresAt, setExpiresAt] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  const [copiedSlug, setCopiedSlug] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchLinks();
      setLinks(list);
    } catch (e: any) {
      setError(e?.message ?? 'erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      await createLink({
        target_url: targetUrl.trim(),
        slug: slug.trim() || undefined,
        title: title.trim() || undefined,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      // Reset form, then reload
      setTargetUrl('');
      setSlug('');
      setTitle('');
      setExpiresAt('');
      await load();
    } catch (e: any) {
      // Translate common server errors to friendlier copy
      const msg = e?.message ?? 'create_failed';
      const friendly =
        msg === 'invalid_target_url'
          ? 'URL inválida. Use http:// ou https://.'
          : msg === 'invalid_slug'
            ? 'Slug inválido. Use 2-60 caracteres: letras minúsculas, números, _ ou -.'
            : msg === 'slug_in_use'
              ? 'Esse slug já está em uso. Tente outro.'
              : msg === 'admin_only'
                ? 'Só Admin/Suporte pode criar links curtos.'
                : msg;
      setCreateError(friendly);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, slug: string) => {
    if (!window.confirm(`Apagar o link /l/${slug}? Quem tiver o link salvo verá um 404 depois.`)) return;
    try {
      await deleteLink(id);
      setLinks((cur) => cur.filter((l) => l.id !== id));
    } catch (e: any) {
      window.alert(`Falha ao apagar: ${e?.message ?? 'erro'}`);
    }
  };

  const handleCopy = async (slug: string) => {
    const full = `${window.location.origin}/l/${slug}`;
    try {
      await navigator.clipboard.writeText(full);
      setCopiedSlug(slug);
      window.setTimeout(() => setCopiedSlug((c) => (c === slug ? null : c)), 1500);
    } catch {
      // Older browsers without clipboard API — fall back to visible textarea
      window.prompt('Copie o link:', full);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold text-slate-100">Links Curtos</h2>
        <p className="text-slate-400 text-sm mt-1">
          Crie URLs curtas e personalizáveis (
          <code className="bg-slate-700 px-1 rounded text-slate-200">
            {window.location.origin}/l/seu-slug
          </code>
          ) que redirecionam pra qualquer página do app, do chatbot, do cadastro de equipe, ou pra um link externo qualquer.
        </p>
      </header>

      {/* Create form */}
      <Card>
        <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Plus className="h-5 w-5" /> Novo link
        </h3>
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="URL de destino *"
            id="target_url"
            type="url"
            placeholder="https://campanhapro2.tesseractauto.com.br/app/crm"
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            required
            autoComplete="off"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Slug (opcional)"
              id="slug"
              placeholder="ana-crm  (em branco = gerado automaticamente)"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              autoComplete="off"
              maxLength={60}
            />
            <Input
              label="Título interno (opcional)"
              id="title"
              placeholder="CRM da Ana - grupo de líderes"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoComplete="off"
              maxLength={200}
            />
          </div>
          <Input
            label="Expira em (opcional)"
            id="expiresAt"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            autoComplete="off"
          />
          {createError && (
            <p className="bg-red-500/10 text-red-400 text-sm p-3 rounded-lg">{createError}</p>
          )}
          <div>
            <Button type="submit" disabled={creating || !targetUrl.trim()}>
              {creating ? 'Criando…' : 'Criar link'}
            </Button>
          </div>
        </form>
      </Card>

      {/* List */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-slate-200">Seus links ({links.length})</h3>
          <button
            type="button"
            onClick={load}
            className="text-slate-400 hover:text-slate-200 p-1 rounded transition"
            title="Recarregar"
            aria-label="Recarregar"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <p className="text-slate-400 text-sm">Carregando…</p>
        ) : error ? (
          <p className="bg-red-500/10 text-red-400 text-sm p-3 rounded-lg">{error}</p>
        ) : links.length === 0 ? (
          <p className="text-slate-400 text-sm">
            Nenhum link curto criado ainda. Use o formulário acima pra criar o primeiro.
          </p>
        ) : (
          <ul className="divide-y divide-slate-700">
            {links.map((l) => {
              const fullUrl = `${window.location.origin}/l/${l.slug}`;
              const expired = l.expiresAt && new Date(l.expiresAt) < new Date();
              return (
                <li key={l.id} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="bg-slate-700 px-2 py-1 rounded text-sm text-slate-100 break-all">
                        /l/{l.slug}
                      </code>
                      {expired && (
                        <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">expirado</span>
                      )}
                      {l.title && <span className="text-slate-300 text-sm">— {l.title}</span>}
                    </div>
                    <a
                      href={l.target_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 text-xs mt-1 flex items-center gap-1 hover:text-slate-200 break-all"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="break-all">{l.target_url}</span>
                    </a>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-400 flex-wrap">
                      <span className="flex items-center gap-1">
                        <BarChart3 className="h-3 w-3" />
                        {l.clicks} {l.clicks === 1 ? 'clique' : 'cliques'}
                      </span>
                      {l.lastClickAt && (
                        <span>último: {formatDate(l.lastClickAt)}</span>
                      )}
                      {l.expiresAt && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          expira: {formatDate(l.expiresAt)}
                        </span>
                      )}
                      <span className="text-slate-500">criado: {formatDate(l.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopy(l.slug)}
                      className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs px-3 py-2 rounded flex items-center gap-1 transition"
                      title={`Copiar ${fullUrl}`}
                    >
                      <Copy className="h-3 w-3" />
                      {copiedSlug === l.slug ? 'Copiado!' : 'Copiar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(l.id, l.slug)}
                      className="bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs px-3 py-2 rounded flex items-center gap-1 transition"
                      title="Apagar"
                      aria-label="Apagar"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default ShortLinksPage;

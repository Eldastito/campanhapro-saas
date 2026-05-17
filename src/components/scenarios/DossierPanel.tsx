import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import { FileText, Plus, Play, XCircle, Loader2, AlertTriangle, ShieldAlert, CheckCircle } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

type DossierStatus = 'pending_approval' | 'approved' | 'rejected';
type SubjectType = 'candidate' | 'opponent' | 'ally';

interface Dossier {
  id: string;
  subject_name: string;
  subject_type: SubjectType;
  status: DossierStatus;
  content: string;
  created_at: string;
}

const STATUS_META: Record<DossierStatus, { label: string; icon: React.ReactNode; color: string }> = {
  pending_approval: {
    label: 'Aguarda Aprovação',
    icon: <ShieldAlert className="w-3.5 h-3.5" />,
    color: 'text-amber-300 bg-amber-500/20',
  },
  approved: {
    label: 'Aprovado',
    icon: <CheckCircle className="w-3.5 h-3.5" />,
    color: 'text-emerald-300 bg-emerald-500/20',
  },
  rejected: {
    label: 'Rejeitado',
    icon: <XCircle className="w-3.5 h-3.5" />,
    color: 'text-slate-400 bg-slate-500/20',
  },
};

const SUBJECT_LABELS: Record<SubjectType, string> = {
  candidate: 'Candidato Próprio',
  opponent: 'Adversário',
  ally: 'Aliado',
};

const StatusBadge: React.FC<{ status: DossierStatus }> = ({ status }) => {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${m.color}`}>
      {m.icon} {m.label}
    </span>
  );
};

export const DossierPanel: React.FC = () => {
  const [dossiers, setDossiers] = React.useState<Dossier[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);

  // Form state
  const [subjectName, setSubjectName] = React.useState('');
  const [subjectType, setSubjectType] = React.useState<SubjectType>('opponent');
  const [content, setContent] = React.useState('');
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const fetchDossiers = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch('/api/v1/scenarios/dossiers');
      if (res.ok) {
        const json = await res.json();
        setDossiers(json.dossiers ?? []);
      }
    } catch {
      // empty state
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { fetchDossiers(); }, [fetchDossiers]);

  const handleAction = async (id: string, action: 'approve' | 'reject') => {
    setActionLoading(id);
    try {
      await authedFetch(`/api/v1/scenarios/dossiers/${id}/${action}`, { method: 'POST' });
      await fetchDossiers();
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreate = async () => {
    if (!subjectName.trim() || !content.trim()) {
      setFormError('Preencha todos os campos.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await authedFetch('/api/v1/scenarios/dossiers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjectName: subjectName.trim(), subjectType, content: content.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Erro ao criar dossiê');
      setSubjectName(''); setContent(''); setShowForm(false);
      await fetchDossiers();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const pendingCount = dossiers.filter(d => d.status === 'pending_approval').length;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-200 flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-400" />
              Dossiês Políticos
            </h3>
            {pendingCount > 0 && (
              <p className="text-xs text-amber-400 mt-0.5">
                {pendingCount} dossiê{pendingCount !== 1 ? 's' : ''} aguarda{pendingCount === 1 ? '' : 'm'} aprovação humana
              </p>
            )}
          </div>
          <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setShowForm(s => !s)}>
            <Plus className="w-3 h-3 mr-1" />
            Novo Dossiê
          </Button>
        </div>

        {showForm && (
          <div className="border border-slate-700 rounded-xl p-4 mb-4 space-y-3 bg-slate-800/50">
            <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 rounded p-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Dossiês criados por IA requerem aprovação humana antes de qualquer uso. Nunca atribua informações falsas a pessoas reais.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Nome do Sujeito</label>
                <input
                  className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-indigo-500"
                  value={subjectName}
                  onChange={e => setSubjectName(e.target.value)}
                  placeholder="Ex: João Silva"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 mb-1 block">Tipo</label>
                <select
                  className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-1.5 text-slate-300"
                  value={subjectType}
                  onChange={e => setSubjectType(e.target.value as SubjectType)}
                >
                  {(Object.entries(SUBJECT_LABELS) as [SubjectType, string][]).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Conteúdo do Dossiê</label>
              <textarea
                rows={4}
                className="w-full text-sm bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-slate-200 focus:outline-none focus:border-indigo-500 resize-none"
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Perfil político, histórico de votação, alianças, pontos vulneráveis..."
              />
            </div>
            {formError && (
              <p className="text-xs text-red-400 bg-red-500/10 rounded px-2 py-1">{formError}</p>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" className="text-xs px-3 py-1.5" onClick={() => setShowForm(false)}>
                Cancelar
              </Button>
              <Button variant="primary" className="text-xs px-3 py-1.5" onClick={handleCreate} disabled={submitting}>
                {submitting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                Criar (Pendente Aprovação)
              </Button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8 text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : dossiers.length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            <FileText className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p>Nenhum dossiê cadastrado.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {dossiers.map(d => (
              <div key={d.id} className="border border-slate-700 rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-slate-700/40 transition-colors"
                  onClick={() => setExpanded(e => e === d.id ? null : d.id)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <StatusBadge status={d.status} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-200 truncate">{d.subject_name}</p>
                      <p className="text-xs text-slate-500">{SUBJECT_LABELS[d.subject_type]}</p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 ml-3 shrink-0">
                    {new Date(d.created_at).toLocaleDateString('pt-BR')}
                  </span>
                </button>

                {expanded === d.id && (
                  <div className="px-4 pb-4 pt-2 border-t border-slate-700/60 space-y-3">
                    <pre className="text-xs text-slate-300 whitespace-pre-wrap bg-slate-800 rounded p-3 max-h-40 overflow-y-auto">
                      {d.content}
                    </pre>
                    {d.status === 'pending_approval' && (
                      <div className="flex gap-2">
                        <Button
                          variant="primary"
                          className="text-xs px-3 py-1.5"
                          disabled={actionLoading === d.id}
                          onClick={() => handleAction(d.id, 'approve')}
                        >
                          {actionLoading === d.id ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                          Aprovar
                        </Button>
                        <Button
                          variant="secondary"
                          className="text-xs px-3 py-1.5"
                          disabled={actionLoading === d.id}
                          onClick={() => handleAction(d.id, 'reject')}
                        >
                          Rejeitar
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};

export default DossierPanel;

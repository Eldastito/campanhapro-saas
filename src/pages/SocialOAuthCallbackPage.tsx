/**
 * Página de callback OAuth para X e LinkedIn (#123).
 *
 * O provedor (X, LinkedIn) redireciona pra cá com ?code=...&state=...
 * Trocamos o code por token no backend (autenticado pela sessão Supabase
 * que já existe no navegador), e redirecionamos de volta pro Quartel General.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const SocialOAuthCallbackPage: React.FC = () => {
  const { provider } = useParams<{ provider: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Conectando à rede social...');

  useEffect(() => {
    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          setStatus('error');
          setMessage(`O provedor retornou um erro: ${error}`);
          return;
        }
        if (!code || !state) {
          setStatus('error');
          setMessage('Faltam parâmetros code/state na URL.');
          return;
        }
        if (provider !== 'x' && provider !== 'linkedin') {
          setStatus('error');
          setMessage('Provedor desconhecido.');
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) {
          // Não está logado: salva intent e manda pro login
          sessionStorage.setItem('oauth_pending', JSON.stringify({ provider, code, state }));
          navigate('/login');
          return;
        }

        const r = await fetch(`/api/v1/social/connect/${provider}/callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ code, state }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setStatus('error');
          setMessage(`Falha ao concluir conexão: ${j?.error || `HTTP ${r.status}`}`);
          return;
        }
        setStatus('success');
        setMessage(`Conexão com ${provider === 'x' ? 'X (Twitter)' : 'LinkedIn'} concluída!`);
        setTimeout(() => navigate('/app/agents'), 2000);
      } catch (err: any) {
        setStatus('error');
        setMessage(err?.message || 'Erro inesperado.');
      }
    };
    run();
  }, [provider, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center justify-center mb-6">
          {status === 'loading' && <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />}
          {status === 'success' && <CheckCircle2 className="w-12 h-12 text-emerald-500" />}
          {status === 'error' && <AlertCircle className="w-12 h-12 text-red-500" />}
        </div>
        <h1 className="text-xl font-bold text-white text-center mb-2">
          {status === 'success' ? 'Sucesso!' : status === 'error' ? 'Algo deu errado' : 'Conectando...'}
        </h1>
        <p className="text-sm text-slate-400 text-center">{message}</p>
        {status === 'error' && (
          <button
            onClick={() => navigate('/app/agents')}
            className="mt-6 w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold transition-all"
          >
            Voltar ao Quartel General
          </button>
        )}
      </div>
    </div>
  );
};

export default SocialOAuthCallbackPage;

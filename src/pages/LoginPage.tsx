import * as React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { SmokeyBackground } from '../components/ui/SmokeyBackground';
import { LOGO_MONO_BASE64 } from '../constants';
import { useNavigate, Link } from 'react-router-dom';
import { User, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';

const LoginPage = () => {
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/app');
    } catch (err: any) {
      if (err.message === 'Invalid login credentials') {
        setError('E-mail ou senha inválidos. Verifique suas credenciais.');
      } else if (err.message === 'Email not confirmed') {
        setError('Você precisa verificar seu e-mail antes de acessar.');
      } else {
        setError(err.message || 'Ocorreu um erro.');
      }
    }
  };

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-slate-950">
      {/* Fundo WebGL animado */}
      <SmokeyBackground color="#1d4ed8" backdropBlurAmount="sm" className="absolute inset-0" />

      {/* Conteúdo */}
      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-4">
        <Link to="/" className="mb-6">
          <img src={LOGO_MONO_BASE64} alt="Logo Campanha Pró" className="h-12 w-12 mx-auto drop-shadow-lg" />
        </Link>

        <div className="w-full max-w-sm space-y-6 rounded-2xl border border-white/15 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-white">Acessar Plataforma</h2>
            <p className="mt-2 text-sm text-slate-300">Entre para continuar</p>
          </div>

          {error && (
            <p className="rounded-lg bg-red-500/15 p-3 text-center text-sm text-red-300" role="alert">
              {error}
            </p>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* E-mail */}
            <div>
              <label htmlFor="login_email" className="mb-1.5 block text-xs font-medium text-slate-300">
                E-mail
              </label>
              <div className="relative">
                <User className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type="email"
                  id="login_email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field-dark w-full rounded-xl border border-white/15 bg-white/5 py-3 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
                  placeholder="seu@email.com"
                  autoComplete="email"
                  required
                />
              </div>
            </div>

            {/* Senha com mostrar/ocultar */}
            <div>
              <label htmlFor="login_password" className="mb-1.5 block text-xs font-medium text-slate-300">
                Senha
              </label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="login_password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="field-dark w-full rounded-xl border border-white/15 bg-white/5 py-3 pl-10 pr-11 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-white"
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <Link to="/forgot-password" className="text-xs text-slate-300 transition hover:text-white">
                Esqueceu a senha?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="group flex w-full items-center justify-center rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white transition-all duration-300 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isLoading ? 'Entrando...' : 'Entrar'}
              {!isLoading && (
                <ArrowRight className="ml-2 h-5 w-5 transform transition-transform group-hover:translate-x-1" />
              )}
            </button>
          </form>

          <div className="space-y-3 text-center text-sm">
            <p className="text-slate-300">
              Não tem uma conta?{' '}
              <Link to="/register" className="font-semibold text-sky-400 transition hover:text-sky-300">
                Cadastre-se
              </Link>
            </p>
            <p>
              <Link to="/" className="flex items-center justify-center gap-2 text-slate-400 transition hover:text-white">
                <span aria-hidden>&larr;</span> Voltar para a página inicial
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
};

export default LoginPage;

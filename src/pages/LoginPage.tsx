import * as React from 'react';
import { useAuth } from '../contexts/AuthContext';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { LOGO_MONO_BASE64 } from '../constants';
import { useNavigate, Link } from 'react-router-dom';

const LoginPage = () => {
  const { login, isLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
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
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
      <div className="text-center mb-8">
        <Link to="/">
          <img src={LOGO_MONO_BASE64} alt="Logo Campanha Pró" className="h-12 w-12 mx-auto" />
        </Link>
      </div>
      <Card className="w-full max-w-md">
        <h2 className="text-2xl font-bold text-center text-slate-200 mb-6">Acessar Plataforma</h2>
        {error && <p className="bg-red-500/10 text-red-400 text-sm text-center p-3 rounded-lg mb-4">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Email"
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
          <Input
            label="Senha"
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
          <div className="text-right text-sm">
            <Link to="/forgot-password" virtual-link="true" className="text-sky-400 hover:underline">Esqueceu a senha?</Link>
          </div>
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>

        <div className="mt-8 text-center text-sm">
            <p className="text-slate-400">
                Não tem uma conta?{' '}
                <Link to="/register" className="font-semibold text-[#4ac7f0] hover:underline">
                    Cadastre-se
                </Link>
            </p>
            <p className="text-slate-400 mt-6">
                 <Link to="/" className="hover:underline flex items-center justify-center gap-2">
                    <span>&larr;</span> Voltar para a página inicial
                </Link>
            </p>
        </div>
      </Card>
    </div>
  );
};

export default LoginPage;
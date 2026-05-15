import * as React from 'react';
import { useAuth } from '../contexts/AuthContext';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { LOGO_MONO_BASE64 } from '../constants';

interface ForgotPasswordPageProps {
  onNavigateToLogin: () => void;
}

const ForgotPasswordPage = ({ onNavigateToLogin }: ForgotPasswordPageProps) => {
  const { sendPasswordReset, isLoading } = useAuth();
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    try {
      await sendPasswordReset(email);
      setSuccess('Email de recuperação enviado com sucesso! Verifique sua caixa de entrada.');
    } catch (err: any) {
      setError(err.message || 'Ocorreu um erro ao enviar o email.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
      <div className="text-center mb-8">
        <img src={LOGO_MONO_BASE64} alt="Logo Campanha Pró" className="h-12 w-12 mx-auto" />
      </div>
      <Card className="w-full max-w-md">
        <h2 className="text-2xl font-bold text-center text-slate-200 mb-2">Recuperar Senha</h2>
        <p className="text-center text-slate-400 text-sm mb-6">Digite seu email para receber o link de recuperação.</p>
        
        {error && <p className="bg-red-500/10 text-red-400 text-sm text-center p-3 rounded-lg mb-4">{error}</p>}
        {success && <p className="bg-green-500/10 text-green-400 text-sm text-center p-3 rounded-lg mb-4">{success}</p>}

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
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Enviando...' : 'Enviar Link de Recuperação'}
          </Button>
        </form>
        <div className="mt-6 text-center text-sm">
          <p className="text-slate-400">
            Lembrou a senha?{' '}
            <button type="button" onClick={onNavigateToLogin} className="font-semibold text-[#4ac7f0] hover:underline">
              Faça o login
            </button>
          </p>
        </div>
      </Card>
    </div>
  );
};

export default ForgotPasswordPage;
import * as React from 'react';
import { useAuth } from '../contexts/AuthContext';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Button from '../components/ui/Button';
import { LOGO_MONO_BASE64 } from '../constants';

import { Link } from 'react-router-dom';

const RegisterPage = () => {
  const { register, isLoading } = useAuth();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [error, setError] = React.useState('');
  const [success, setSuccess] = React.useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (password !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    try {
      await register(name, email, password);
      setSuccess('Cadastro realizado com sucesso! Você já pode fazer o login.');
      // clear form
      setName('');
      setEmail('');
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      if (err.message === 'User already registered') {
        setError('Este e-mail já está em uso. Tente fazer o login.');
      } else if (err.message?.includes('Password should be at least')) {
        setError('A senha deve ter pelo menos 6 caracteres.');
      } else {
        setError(err.message || 'Ocorreu um erro no cadastro.');
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
        <h2 className="text-2xl font-bold text-center text-slate-200 mb-6">Criar Nova Conta</h2>
        {error && <p className="bg-red-500/10 text-red-400 text-sm text-center p-3 rounded-lg mb-4">{error}</p>}
        {success && <p className="bg-green-500/10 text-green-400 text-sm text-center p-3 rounded-lg mb-4">{success}</p>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Nome Completo" id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          <Input label="Email" id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input label="Senha" id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Input label="Confirmar Senha" id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
          
          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? 'Criando conta...' : 'Cadastrar'}
          </Button>
        </form>

        <div className="mt-8 text-center text-sm">
          <p className="text-slate-400">
            Já tem uma conta?{' '}
            <Link to="/login" className="font-semibold text-[#4ac7f0] hover:underline">
              Faça o login
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

export default RegisterPage;
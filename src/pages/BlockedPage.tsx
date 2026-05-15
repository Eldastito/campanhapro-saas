import * as React from 'react';
import { ShieldAlert, LogOut, Mail } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const BlockedPage: React.FC = () => {
    const { user, logout } = useAuth();

    return (
        <div className="min-h-screen bg-slate-900 text-slate-50 flex items-center justify-center p-6">
            <div className="max-w-md w-full bg-slate-800 border border-red-500/30 rounded-3xl p-10 shadow-2xl text-center">
                <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                    <ShieldAlert className="w-10 h-10 text-red-400" />
                </div>

                <h1 className="text-2xl font-black mb-3">Conta bloqueada</h1>

                <p className="text-slate-400 leading-relaxed mb-8">
                    Sua conta foi suspensa e o acesso à plataforma está temporariamente indisponível.
                    Entre em contato com o administrador da sua campanha para regularizar a situação.
                </p>

                {user?.email && (
                    <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4 mb-6 text-left">
                        <p className="text-xs uppercase tracking-widest text-slate-500 mb-1">Conta bloqueada</p>
                        <p className="text-sm font-mono text-slate-300 flex items-center gap-2">
                            <Mail className="w-4 h-4" /> {user.email}
                        </p>
                    </div>
                )}

                <button
                    onClick={() => logout()}
                    className="w-full py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold transition-all flex items-center justify-center gap-2"
                >
                    <LogOut className="w-4 h-4" /> Sair
                </button>
            </div>
        </div>
    );
};

export default BlockedPage;

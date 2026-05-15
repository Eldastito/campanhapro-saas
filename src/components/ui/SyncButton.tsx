import * as React from 'react';
import { RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react';
import Button from './Button';
import { migrateLocalToSupabase, hasDataToMigrate, MigrationSummary } from '../../services/migrationService';
import { useAuth } from '../../contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';

const SyncButton: React.FC = () => {
  const { user } = useAuth();
  const [show, setShow] = React.useState(false);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [summary, setSummary] = React.useState<MigrationSummary | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Só mostra se houver dados locais e usuário estiver logado
    if (user?.campaignId && hasDataToMigrate()) {
      setShow(true);
    }
  }, [user]);

  const handleSync = async () => {
    if (!user?.campaignId) return;
    
    setIsSyncing(true);
    setError(null);
    try {
      const result = await migrateLocalToSupabase(user.campaignId);
      setSummary(result);
      
      // Limpa após 5 segundos
      setTimeout(() => {
        setShow(false);
        // Após o sync bem sucedido e exibição, recarregamos a página para os contextos pegarem os dados novos
        window.location.reload();
      }, 5000);
    } catch (err: any) {
      console.error(err);
      setError("Erro ao sincronizar. Tente novamente mais tarde.");
      setIsSyncing(false);
    }
  };

  if (!show) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6 flex flex-col md:flex-row items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3 text-amber-200">
          <AlertTriangle className="w-6 h-6 shrink-0" />
          <div className="text-sm">
            <p className="font-bold">Resgate de Dados Detectado!</p>
            <p>Você tem informações salvas apenas neste navegador. Deseja enviá-las para o servidor do Google Cloud?</p>
          </div>
        </div>

        {!summary ? (
          <Button 
            variant="primary" 
            onClick={handleSync} 
            disabled={isSyncing}
            className="bg-amber-600 hover:bg-amber-500 border-none whitespace-nowrap"
          >
            <RefreshCw className={`mr-2 h-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            {isSyncing ? 'Sincronizando...' : 'Sincronizar Agora'}
          </Button>
        ) : (
          <div className="flex items-center gap-2 text-emerald-400 font-bold bg-emerald-400/10 px-4 py-2 rounded-lg">
            <CheckCircle className="w-5 h-5" />
            <span>Sucesso! {summary.visits + summary.team + summary.financial} itens migrados.</span>
          </div>
        )}

        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </motion.div>
    </AnimatePresence>
  );
};

export default SyncButton;

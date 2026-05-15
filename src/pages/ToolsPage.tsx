import * as React from 'react';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useVisits } from '../contexts/VisitsContext';
import { useCalculator } from '../contexts/CalculatorContext';
import { useSettings } from '../contexts/SettingsContext';
import { DownloadIcon, UploadIcon } from '../components/icons';
import { exportToCsv } from '../utils/helpers';
import { usePermissions } from '../hooks/usePermissions';
import ImageUpload from '../components/ui/ImageUpload';
import { useAuth } from '../contexts/AuthContext';
import { createBackup, restoreBackup } from '../services/backupService';

const ToolsPage = () => {
  const { user } = useAuth();
  const { visits, engagementActions } = useVisits();
  const { scenarios } = useCalculator();
  const { headerLogo, updateHeaderLogo, footerLogo, updateFooterLogo } = useSettings();
  const permissions = usePermissions();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  
  const [isBackupLoading, setIsBackupLoading] = React.useState(false);

  const handleBackup = async () => {
      if (!user?.campaignId) return;
      setIsBackupLoading(true);
      try {
          const backupId = await createBackup(user.campaignId, `Backup Automático ${new Date().toLocaleDateString()}`);
          alert(`Backup realizado com sucesso! ID: ${backupId}`);
      } catch (error: any) {
          alert(`Erro ao realizar backup: ${error.message}`);
      } finally {
          setIsBackupLoading(false);
      }
  }
  
  const handleRestoreClick = () => {
      const backupId = prompt("Por favor, insira o ID do backup para restaurar:");
      if (!backupId) return;
      
      if (confirm("Deseja realmente restaurar este backup? Dados atuais podem ser sobrescritos.")) {
          restoreBackup(backupId)
              .then(() => alert("Backup restaurado com sucesso! Recarregue a página para ver as mudanças."))
              .catch(err => alert(`Erro na restauração: ${err.message}`));
      }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-slate-200">Ferramentas e Configurações</h2>

      <Card>
        <h3 className="font-bold text-lg text-slate-300 mb-4">Personalização Visual</h3>
        <p className="text-sm text-slate-400 mb-4">
          Faça o upload dos logos da sua campanha para personalizar a plataforma e os relatórios.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ImageUpload 
                label="Logo do Cabeçalho (Topo)"
                currentImage={headerLogo}
                onImageUpload={(base64) => updateHeaderLogo(base64)}
                onImageRemove={() => updateHeaderLogo(null)}
            />
            <ImageUpload 
                label="Logo do Rodapé (Relatórios)"
                currentImage={footerLogo}
                onImageUpload={(base64) => updateFooterLogo(base64)}
                onImageRemove={() => updateFooterLogo(null)}
            />
        </div>
      </Card>
      
      <Card>
        <h3 className="font-bold text-lg text-slate-300 mb-4">Backup e Restauração</h3>
        <p className="text-sm text-slate-400 mb-4">
          Guarde uma cópia de segurança de todos os seus dados (visitas, cenários, etc.) em um único arquivo. 
          Isso é útil para transferir dados ou se precaver contra perdas.
        </p>
        <div className="flex flex-wrap gap-4">
          <Button onClick={handleBackup} disabled={isBackupLoading} variant="primary">
            {isBackupLoading ? "Processando..." : <><DownloadIcon /> Fazer Backup Completo</>}
          </Button>
          <Button onClick={handleRestoreClick} variant="secondary">
            <UploadIcon /> Restaurar de um Backup
          </Button>
          <input
            type="file"
            ref={fileInputRef}
            accept=".json"
            className="hidden"
          />
        </div>
      </Card>
      
      <Card>
        <h3 className="font-bold text-lg text-slate-300 mb-4">Exportação de Dados (CSV)</h3>
        <p className="text-sm text-slate-400 mb-4">
          Exporte partes específicas dos seus dados para o formato CSV, que pode ser aberto em programas como Excel ou Google Sheets.
        </p>
        <div className="flex flex-wrap gap-4">
            <Button 
              onClick={() => exportToCsv(visits, 'visitas.csv')} 
              variant="secondary"
              disabled={!permissions.canExportData}
              title={!permissions.canExportData ? "Disponível no plano Estratégico ou superior" : ""}
            >
              Exportar Visitas
            </Button>
            <Button 
              onClick={() => exportToCsv(scenarios, 'cenarios.csv')} 
              variant="secondary"
              disabled={!permissions.canExportData}
              title={!permissions.canExportData ? "Disponível no plano Estratégico ou superior" : ""}
            >
              Exportar Cenários
            </Button>
             <Button 
              onClick={() => exportToCsv(engagementActions, 'acoes_engajamento.csv')} 
              variant="secondary"
              disabled={!permissions.canExportData}
              title={!permissions.canExportData ? "Disponível no plano Estratégico ou superior" : ""}
             >
              Exportar Ações de Engajamento
             </Button>
        </div>
      </Card>
    </div>
  );
};

export default ToolsPage;
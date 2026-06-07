import * as React from 'react';
import { PesquisaEleitoral } from '../../types/pesquisa';
import Input from '../ui/Input';
import Button from '../ui/Button';

interface PesquisaFormProps {
  onSave: (pesquisa: Omit<PesquisaEleitoral, 'id'>) => void;
  onCancel: () => void;
  onStart?: () => void;
  isSaving?: boolean;
}

const PesquisaForm: React.FC<PesquisaFormProps> = ({ onSave, onCancel, onStart, isSaving }) => {
  React.useEffect(() => {
    if (onStart) onStart();
  }, []);
  
  const [formData, setFormData] = React.useState<Omit<PesquisaEleitoral, 'id'>>({
    data: new Date().toISOString().split('T')[0],
    entrevistadorId: '',
    bairro: '',
    genero: 'nao_informado',
    faixaEtaria: '35-44',
    intencaoVoto: 'indeciso',
    fatorRejeicao: 'nenhum',
    consumoNoticias: 'whatsapp',
    dorImediata: 'saude',
    notaBairro: 3,
    perfilRespostas: [],
    observacoes: '',
  });

  const [q1, setQ1] = React.useState('D');
  const [q2, setQ2] = React.useState('I');
  const [q3, setQ3] = React.useState('S');
  const [q4, setQ4] = React.useState('C');
  const [q5, setQ5] = React.useState('D');
  const [q6, setQ6] = React.useState('I');

  // Identificação opcional do entrevistado → vira um contato (lead) no CRM.
  const [lead, setLead] = React.useState({ nome: '', telefone: '', zona: '', secao: '', optin: false });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const calcularDISC = () => {
    const respostas = [q1, q2, q3, q4, q5, q6];
    let counts = { D: 0, I: 0, S: 0, C: 0 };
    
    respostas.forEach(r => {
        if (r === 'D') counts.D++;
        if (r === 'I') counts.I++;
        if (r === 'S') counts.S++;
        if (r === 'C') counts.C++;
    });
    
    const max = Math.max(counts.D, counts.I, counts.S, counts.C);
    if (counts.D === max) return 'D';
    if (counts.I === max) return 'I';
    if (counts.S === max) return 'S';
    return 'C';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalData = {
        ...formData,
        perfilDisc: calcularDISC(),
        perfilRespostas: [q1, q2, q3, q4, q5, q6],
        notaBairro: Number(formData.notaBairro) as 1|2|3|4|5
    };
    onSave({ ...finalData, __lead: lead } as any);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Bairro da Coleta" name="bairro" value={formData.bairro} onChange={handleChange} required />
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Gênero</label>
            <select name="genero" value={formData.genero} onChange={handleChange} className="w-full bg-slate-700 p-2 rounded">
              <option value="masculino">Masculino</option>
              <option value="feminino">Feminino</option>
              <option value="outro">Outro</option>
              <option value="nao_informado">Não informar</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Faixa Etária</label>
            <select name="faixaEtaria" value={formData.faixaEtaria} onChange={handleChange} className="w-full bg-slate-700 p-2 rounded">
              <option value="16-24">16 - 24 anos</option>
              <option value="25-34">25 - 34 anos</option>
              <option value="35-44">35 - 44 anos</option>
              <option value="45-59">45 - 59 anos</option>
              <option value="60+">60+ anos</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Nota para o Bairro (1-5)</label>
            <select name="notaBairro" value={formData.notaBairro} onChange={handleChange} className="w-full bg-slate-700 p-2 rounded">
              <option value="1">1 - Péssimo</option>
              <option value="2">2 - Ruim</option>
              <option value="3">3 - Regular</option>
              <option value="4">4 - Bom</option>
              <option value="5">5 - Excelente</option>
            </select>
          </div>
      </div>

      {/* Identificação opcional → cria contato/lead no CRM (alimenta o funil) */}
      <div className="p-4 bg-blue-900/10 border border-blue-500/20 rounded-lg space-y-3">
        <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Identificação (opcional — vira contato/lead)</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Nome do entrevistado" name="nome" value={lead.nome} onChange={(e) => setLead({ ...lead, nome: e.target.value })} />
          <Input label="WhatsApp / Telefone" name="telefone" value={lead.telefone} onChange={(e) => setLead({ ...lead, telefone: e.target.value })} />
          <Input label="Zona eleitoral" name="zona" value={lead.zona} onChange={(e) => setLead({ ...lead, zona: e.target.value })} />
          <Input label="Seção eleitoral" name="secao" value={lead.secao} onChange={(e) => setLead({ ...lead, secao: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" className="accent-blue-500" checked={lead.optin} onChange={(e) => setLead({ ...lead, optin: e.target.checked })} />
          Autoriza contato no WhatsApp (LGPD)
        </label>
        <p className="text-[10px] text-slate-500">Se preencher nome/telefone, o entrevistado entra no CRM com a intenção de voto desta pesquisa.</p>
      </div>

      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 space-y-4">
        <h4 className="font-bold text-slate-200">Vetores Mapeáveis (IA)</h4>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Intenção de Voto</label>
              <select name="intencaoVoto" value={formData.intencaoVoto} onChange={handleChange} className="w-full bg-slate-700 p-2 rounded">
                <option value="candidato">Votaria no Candidato</option>
                <option value="outro">Votaria na Oposição</option>
                <option value="branco/nulo">Branco / Nulo</option>
                <option value="indeciso">Indeciso</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Fator de Rejeição (Não votaria se...)</label>
              <select name="fatorRejeicao" value={formData.fatorRejeicao} onChange={handleChange} className="w-full bg-slate-700 p-2 rounded">
                <option value="corrupcao">Corrupção</option>
                <option value="extremismo">Extremismo Político</option>
                <option value="inexperiencia">Inexperiência Administrativa</option>
                <option value="propostas_ruins">Propostas Irreais</option>
                <option value="nenhum">Sem grande rejeição</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Principal Fonte de Informação</label>
              <select name="consumoNoticias" value={formData.consumoNoticias} onChange={handleChange} className="w-full bg-slate-700 p-2 rounded">
                <option value="whatsapp">Grupos de WhatsApp</option>
                <option value="instagram">Instagram / TikTok</option>
                <option value="facebook">Facebook</option>
                <option value="tv">Televisão / Jornais Locais</option>
                <option value="boca_a_boca">Conhecidos (Boca a boca)</option>
                <option value="igreja">Igreja / Comunidade</option>
                <option value="outros">Outros</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Dor Imediata (O que falta hoje?)</label>
              <select name="dorImediata" value={formData.dorImediata} onChange={handleChange} className="w-full bg-slate-700 p-2 rounded">
                <option value="saude">Falta Médicos / Postos de Saúde</option>
                <option value="educacao">Vagas em Creche e Escolas</option>
                <option value="seguranca">Violência / Sensação de Insegurança</option>
                <option value="transporte">Ônibus cheio / Mobilidade Ruim</option>
                <option value="emprego">Falta de Emprego na Sub-região</option>
                <option value="infraestrutura">Asfalto, Lixo e Iluminação</option>
                <option value="lazer">Parques, Praças e Lazer Seguro</option>
              </select>
            </div>
        </div>
      </div>

      <div className="border-t border-slate-700 pt-4">
        <h4 className="text-md font-bold text-slate-200 mb-2">Perfil Comportamental (Leitura Rápida DISC)</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400 font-bold uppercase">1. Atitude Predominante</label>
            <select value={q1} onChange={e => setQ1(e.target.value)} className="w-full bg-slate-700 p-2 rounded text-sm mt-1 border border-slate-600">
                <option value="D">Competitivo e Decidido</option>
                <option value="I">Entusiasta e Comunicativo</option>
                <option value="S">Calmo e Paciente</option>
                <option value="C">Analítico e Reservado</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 font-bold uppercase">2. Prioridade no Dia a Dia</label>
            <select value={q2} onChange={e => setQ2(e.target.value)} className="w-full bg-slate-700 p-2 rounded text-sm mt-1 border border-slate-600">
                <option value="D">Resultados e Metas</option>
                <option value="I">Relacionamentos e Reconhecimento</option>
                <option value="S">Segurança e Colaboração</option>
                <option value="C">Precisão e Qualidade</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 font-bold uppercase">3. Reação sob Pressão</label>
            <select value={q3} onChange={e => setQ3(e.target.value)} className="w-full bg-slate-700 p-2 rounded text-sm mt-1 border border-slate-600">
                <option value="D">Fica Impaciente / Agressivo</option>
                <option value="I">Fica Persuasivo / Desorganizado</option>
                <option value="S">Fica Hesitante / Calado</option>
                <option value="C">Fica Crítico / Perfeccionista</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 font-bold uppercase">4. Estilo de Comunicação</label>
            <select value={q4} onChange={e => setQ4(e.target.value)} className="w-full bg-slate-700 p-2 rounded text-sm mt-1 border border-slate-600">
                <option value="D">Direto e Objetivo</option>
                <option value="I">Animado e Influente</option>
                <option value="S">Gentil e Bom Ouvinte</option>
                <option value="C">Diplomático e Formal</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 font-bold uppercase">5. Tomada de Decisão</label>
            <select value={q5} onChange={e => setQ5(e.target.value)} className="w-full bg-slate-700 p-2 rounded text-sm mt-1 border border-slate-600">
                <option value="D">Rápida e Independente</option>
                <option value="I">Baseada em Intuição / Social</option>
                <option value="S">Cuidadosa e Consensual</option>
                <option value="C">Baseada em Fatos e Lógica</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 font-bold uppercase">6. Ritmo de Trabalho</label>
            <select value={q6} onChange={e => setQ6(e.target.value)} className="w-full bg-slate-700 p-2 rounded text-sm mt-1 border border-slate-600">
                <option value="D">Acelerado e Focado em Prazos</option>
                <option value="I">Variado e Focado em Novidades</option>
                <option value="S">Moderado e Estável</option>
                <option value="C">Metódico e Detalhista</option>
            </select>
          </div>
        </div>
      </div>

      <Input label="Observações de Campo" name="observacoes" value={formData.observacoes} onChange={handleChange} />

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isSaving}>Cancelar</Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? 'Gravando...' : 'Gravar Pesquisa'}
        </Button>
      </div>
    </form>
  );
};

export default PesquisaForm;

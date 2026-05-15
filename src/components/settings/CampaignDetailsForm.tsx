import * as React from 'react';
import { CampaignDetails, CARGOS_ELETIVOS } from '../../types/campaign';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Toast from '../ui/Toast';
import ImageUpload from '../ui/ImageUpload';

interface CampaignDetailsFormProps {
    initialDetails: CampaignDetails;
    onSave: (details: CampaignDetails) => void;
}

const CampaignDetailsForm: React.FC<CampaignDetailsFormProps> = ({ initialDetails, onSave }) => {
    const [details, setDetails] = React.useState(initialDetails);
    const [showToast, setShowToast] = React.useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target as HTMLInputElement;
        setDetails(prev => ({
            ...prev,
            [name]: type === 'number' ? parseFloat(value) || 0 : value,
        }));
    };

    const handleImageUpload = (base64: string) => {
        setDetails(prev => ({ ...prev, candidatePhotoUrl: base64 }));
    };

    const handleImageRemove = () => {
        setDetails(prev => ({ ...prev, candidatePhotoUrl: undefined }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave(details);
        setShowToast(true);
    };

    return (
        <>
        {showToast && <Toast message="Informações da campanha salvas com sucesso!" type="success" onClose={() => setShowToast(false)} />}
        <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Input label="Nome Completo do Candidato" name="nomeCompleto" value={details.nomeCompleto} onChange={handleChange} required />
                        <Input label="Nome de Urna" name="nomeUrna" value={details.nomeUrna || ''} onChange={handleChange} placeholder="Ex: João da Farmácia" />
                        <div>
                            <label htmlFor="cargo" className="block text-sm font-medium text-slate-300 mb-1">Cargo Disputado</label>
                            <select
                                id="cargo"
                                name="cargo"
                                value={details.cargo || ''}
                                onChange={handleChange}
                                required
                                className="w-full bg-slate-700 border border-slate-600 rounded-md py-2 px-3 focus:ring-1 focus:ring-indigo-500 outline-none"
                            >
                                <option value="" disabled>Selecione o cargo</option>
                                {CARGOS_ELETIVOS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                        <Input label="Número de Urna" name="numero" value={details.numero || ''} onChange={handleChange} placeholder="Ex: 13, 22.123, 4500..." />
                        <Input label="Partido" name="partido" value={details.partido || ''} onChange={handleChange} placeholder="Ex: PL, PT, MDB..." />
                        <Input label="CNPJ da Campanha" name="cnpj" value={details.cnpj} onChange={handleChange} required />
                        <Input label="CPF" name="cpf" value={details.cpf} onChange={handleChange} required />
                        <Input label="Identidade (RG)" name="identidade" value={details.identidade} onChange={handleChange} required />
                        <Input label="Data de Nascimento" name="dataNascimento" type="date" value={details.dataNascimento} onChange={handleChange} />
                        <Input label="Estado Civil" name="estadoCivil" value={details.estadoCivil} onChange={handleChange} />
                    </div>
                    <Input label="Endereço Completo" name="endereco" value={details.endereco} onChange={handleChange} />
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Input label="Cidade" name="cidade" value={details.cidade} onChange={handleChange} />
                        <Input label="Estado" name="estado" value={details.estado} onChange={handleChange} />
                        <Input label="CEP" name="cep" value={details.cep} onChange={handleChange} />
                    </div>

                    <div className="pt-4 border-t border-slate-700 space-y-4">
                        <p className="text-xs uppercase tracking-widest text-emerald-400 font-bold">Alvo Eleitoral</p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Input
                                label="Data da Eleição"
                                name="electionDate"
                                type="date"
                                value={details.electionDate || ''}
                                onChange={handleChange}
                            />
                            <Input
                                label="UF (Estado da Eleição)"
                                name="electionState"
                                value={details.electionState || ''}
                                onChange={handleChange}
                                placeholder="Ex: RJ"
                                maxLength={2}
                            />
                            <Input
                                label="Cidade da Eleição (se municipal)"
                                name="electionCity"
                                value={details.electionCity || ''}
                                onChange={handleChange}
                                placeholder="Ex: Rio de Janeiro"
                            />
                        </div>
                        <div>
                            <label htmlFor="electionRound" className="block text-sm font-medium text-slate-300 mb-1">
                                Turno
                            </label>
                            <select
                                id="electionRound"
                                name="electionRound"
                                value={details.electionRound || 1}
                                onChange={handleChange}
                                className="w-full max-w-xs bg-slate-700 border border-slate-600 rounded-md py-2 px-3"
                            >
                                <option value={1}>1º turno</option>
                                <option value={2}>2º turno</option>
                            </select>
                        </div>
                    </div>

                    <div className="pt-4 border-t border-slate-700">
                         <Input
                            label="Orçamento Total da Campanha (R$)"
                            name="orcamento"
                            type="number"
                            value={details.orcamento.toString()}
                            onChange={handleChange}
                            step="1000"
                            containerClassName="max-w-xs"
                         />
                    </div>
                </div>
                <div className="lg:col-span-1">
                    <ImageUpload 
                        label="Foto do Candidato"
                        currentImage={details.candidatePhotoUrl}
                        onImageUpload={handleImageUpload}
                        onImageRemove={handleImageRemove}
                        aspectRatio="square"
                    />
                </div>
            </div>
            <div className="flex justify-end pt-8 mt-4 border-t border-slate-700">
                <Button type="submit">Salvar Informações</Button>
            </div>
        </form>
        </>
    );
};

export default CampaignDetailsForm;

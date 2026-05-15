import * as React from 'react';
import Card from '../ui/Card';
import { useSettings } from '../../contexts/SettingsContext';
import { Share2, Download, CheckCircle, Edit2, Camera, Upload } from 'lucide-react';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import Input from '../ui/Input';
import { useAuth } from '../../contexts/AuthContext';
import { toPng } from 'html-to-image';

const DigitalColinha = () => {
    const { user } = useAuth();
    const { campaignDetails, updateCampaignDetails } = useSettings();
    const [copied, setCopied] = React.useState(false);
    const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
    const [isSaving, setIsSaving] = React.useState(false);
    const [isDownloading, setIsDownloading] = React.useState(false);
    const cardRef = React.useRef<HTMLDivElement>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const [editData, setEditData] = React.useState({
        nomeUrna: campaignDetails.nomeUrna || '',
        numero: campaignDetails.numero || '',
        partido: campaignDetails.partido || '',
        candidatePhotoUrl: campaignDetails.candidatePhotoUrl || ''
    });

    React.useEffect(() => {
        setEditData({
            nomeUrna: campaignDetails.nomeUrna || '',
            numero: campaignDetails.numero || '',
            partido: campaignDetails.partido || '',
            candidatePhotoUrl: campaignDetails.candidatePhotoUrl || ''
        });
    }, [campaignDetails]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validar tamanho (max 12MB antes da compressão)
        if (file.size > 12 * 1024 * 1024) {
            alert('A imagem é muito grande. Por favor, escolha uma imagem de até 12MB.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                // Redimensionar para garantir um tamanho adequado para armazenamento no banco de dados
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const max_size = 400; // Tamanho ideal para foto de perfil

                if (width > height) {
                    if (width > max_size) {
                        height *= max_size / width;
                        width = max_size;
                    }
                } else {
                    if (height > max_size) {
                        width *= max_size / height;
                        height = max_size;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);
                
                // Converter para base64 com qualidade reduzida
                const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                setEditData(prev => ({ ...prev, candidatePhotoUrl: dataUrl }));
            };
            img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
    };

    const handleShare = () => {
        const shareUrl = `${window.location.origin}?colinha=${user?.uid}`;
        const text = `Vote em ${campaignDetails.nomeUrna || campaignDetails.nomeCompleto} - Número: ${campaignDetails.numero || '00000'}. Juntos por uma cidade melhor!`;
        
        if (navigator.share) {
            navigator.share({
                title: 'Minha Colinha Digital',
                text: text,
                url: shareUrl
            }).catch(err => console.log('Erro ao compartilhar:', err));
        } else {
            navigator.clipboard.writeText(`${text}\n\n${shareUrl}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleDownload = async () => {
        if (!cardRef.current) return;
        
        try {
            setIsDownloading(true);
            
            // html-to-image é mais robusto com CSS moderno
            const dataUrl = await toPng(cardRef.current, {
                quality: 1.0,
                pixelRatio: 2,
                backgroundColor: '#0f172a',
                style: {
                    borderRadius: '1rem'
                }
            });
            
            const link = document.createElement('a');
            link.href = dataUrl;
            link.download = `colinha-${campaignDetails.nomeUrna || 'candidato'}.png`;
            link.click();
        } catch (error) {
            console.error('Erro ao gerar imagem:', error);
            alert('Erro ao gerar a imagem para download. Tente novamente.');
        } finally {
            setIsDownloading(false);
        }
    };

    const handleSaveEdit = async () => {
        try {
            setIsSaving(true);
            await updateCampaignDetails({
                ...campaignDetails,
                ...editData
            });
            setIsEditModalOpen(false);
        } catch (error) {
            console.error("Erro ao salvar dados do candidato:", error);
            alert("Erro ao salvar as alterações. Por favor, verifique sua conexão e tente novamente.");
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <Card className="h-full flex flex-col justify-between">
            <div>
                <div className="flex justify-between items-start mb-4">
                    <h3 className="font-bold text-lg text-slate-300 flex items-center gap-2">
                        <Share2 className="text-teal-400" /> Colinha Digital
                    </h3>
                    <button 
                        onClick={() => setIsEditModalOpen(true)}
                        className="p-1.5 text-slate-400 hover:text-teal-400 hover:bg-slate-700 rounded-lg transition-colors"
                        title="Editar dados da colinha"
                    >
                        <Edit2 size={16} />
                    </button>
                </div>
                <p className="text-xs text-slate-400 mb-6">
                    Gere um link ou imagem rápida para seus eleitores não esquecerem seu número no dia da votação.
                </p>
                
                <div 
                    ref={cardRef}
                    style={{ 
                        backgroundColor: '#1e293b', 
                        backgroundImage: 'linear-gradient(to bottom right, #1e293b, #0f172a)',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        border: '2px solid rgba(45, 212, 191, 0.3)'
                    }}
                    className="rounded-2xl p-6 relative overflow-hidden"
                >
                    <div 
                        style={{ backgroundColor: 'rgba(45, 212, 191, 0.1)' }}
                        className="absolute top-0 right-0 p-2 rounded-bl-xl border-l border-b border-[#2dd4bf33]"
                    >
                        <span style={{ color: '#2dd4bf' }} className="text-[10px] font-bold uppercase tracking-widest">Eleições 2026</span>
                    </div>
                    
                    <div className="space-y-4">
                        <div className="flex items-center gap-4">
                            {campaignDetails.candidatePhotoUrl ? (
                                <img 
                                    src={campaignDetails.candidatePhotoUrl} 
                                    alt="Candidato" 
                                    style={{ border: '2px solid #2dd4bf' }}
                                    className="w-16 h-16 rounded-full object-cover"
                                    referrerPolicy="no-referrer"
                                />
                            ) : (
                                <div 
                                    style={{ backgroundColor: '#334155', border: '2px solid #2dd4bf' }}
                                    className="w-16 h-16 rounded-full flex items-center justify-center"
                                >
                                    <Camera style={{ color: '#64748b' }} size={24} />
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <h4 style={{ color: '#ffffff' }} className="text-lg sm:text-xl font-black uppercase leading-tight break-words">
                                    {campaignDetails.nomeUrna || 'Nome do Candidato'}
                                </h4>
                                <p style={{ color: '#2dd4bf' }} className="font-bold text-xs sm:text-sm break-words">{campaignDetails.partido || 'Partido'}</p>
                            </div>
                        </div>
                        
                        <div 
                            style={{ backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                            className="rounded-xl p-4 text-center"
                        >
                            <span style={{ color: '#64748b' }} className="text-xs uppercase font-bold tracking-widest block mb-1">Número na Urna</span>
                            <span style={{ color: '#ffffff' }} className="text-4xl font-black tracking-[0.2em]">
                                {campaignDetails.numero || '00.000'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mt-6 flex gap-2">
                <Button onClick={handleShare} className="flex-1">
                    {copied ? <CheckCircle size={18} className="mr-2" /> : <Share2 size={18} className="mr-2" />}
                    {copied ? 'Copiado!' : 'Compartilhar'}
                </Button>
                <Button variant="secondary" onClick={handleDownload} disabled={isDownloading}>
                    <Download size={18} className={isDownloading ? 'animate-bounce' : ''} />
                </Button>
            </div>

            <Modal 
                isOpen={isEditModalOpen} 
                onClose={() => setIsEditModalOpen(false)} 
                title="Editar Dados do Candidato"
            >
                <div className="space-y-4">
                    <Input 
                        label="Nome na Urna"
                        value={editData.nomeUrna}
                        onChange={e => setEditData({...editData, nomeUrna: e.target.value})}
                        placeholder="Ex: João da Silva"
                    />
                    <Input 
                        label="Número"
                        value={editData.numero}
                        onChange={e => setEditData({...editData, numero: e.target.value})}
                        placeholder="Ex: 12345"
                    />
                    <Input 
                        label="Partido"
                        value={editData.partido}
                        onChange={e => setEditData({...editData, partido: e.target.value})}
                        placeholder="Ex: PXYZ"
                    />
                    <div className="space-y-2">
                        <label className="block text-sm font-medium text-slate-400">Envie sua foto</label>
                        <div className="flex items-center gap-4">
                            <div 
                                onClick={() => fileInputRef.current?.click()}
                                className="w-16 h-16 rounded-full bg-slate-800 border-2 border-dashed border-slate-600 flex items-center justify-center cursor-pointer hover:border-teal-500 transition-colors overflow-hidden"
                            >
                                {editData.candidatePhotoUrl ? (
                                    <img src={editData.candidatePhotoUrl} alt="Preview" className="w-full h-full object-cover" />
                                ) : (
                                    <Upload size={20} className="text-slate-500" />
                                )}
                            </div>
                            <div className="flex-1">
                                <button 
                                    type="button"
                                    onClick={() => fileInputRef.current?.click()}
                                    className="text-sm text-teal-400 hover:text-teal-300 font-medium"
                                >
                                    {editData.candidatePhotoUrl ? 'Trocar foto' : 'Selecionar arquivo'}
                                </button>
                                <p className="text-[10px] text-slate-500 mt-1">JPG ou PNG, máx 12MB. A foto será redimensionada automaticamente.</p>
                            </div>
                            <input 
                                ref={fileInputRef}
                                type="file" 
                                accept="image/*" 
                                onChange={handleFileChange}
                                className="hidden"
                            />
                        </div>
                    </div>
                    <div className="flex gap-2 pt-4">
                        <Button 
                            onClick={handleSaveEdit} 
                            className="flex-1"
                            disabled={isSaving}
                        >
                            {isSaving ? 'Salvando...' : 'Salvar Alterações'}
                        </Button>
                        <Button variant="secondary" onClick={() => setIsEditModalOpen(false)} disabled={isSaving}>
                            Cancelar
                        </Button>
                    </div>
                </div>
            </Modal>
        </Card>
    );
};

export default DigitalColinha;

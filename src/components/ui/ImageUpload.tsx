import * as React from 'react';
import { fileToBase64 } from '../../utils/helpers';
import Button from './Button';
import { UploadIcon, TrashIcon } from '../icons';

interface ImageUploadProps {
    label: string;
    currentImage: string | null | undefined;
    onImageUpload: (base64: string) => void;
    onImageRemove: () => void;
    aspectRatio?: 'square' | 'wide';
}

const ImageUpload: React.FC<ImageUploadProps> = ({ label, currentImage, onImageUpload, onImageRemove, aspectRatio = 'wide' }) => {
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = React.useState(false);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setIsUploading(true);
            try {
                const base64 = await fileToBase64(file);
                onImageUpload(base64);
            } catch (error) {
                console.error("Error converting file to base64", error);
            } finally {
                setIsUploading(false);
            }
        }
    };

    const handleClick = () => {
        fileInputRef.current?.click();
    };

    return (
        <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{label}</label>
            <div className={`relative border-2 border-dashed border-slate-600 rounded-lg group transition-colors hover:border-sky-500 ${aspectRatio === 'square' ? 'aspect-square' : 'aspect-video'}`}>
                {currentImage ? (
                    <>
                        <img src={currentImage} alt={label} className="w-full h-full object-contain rounded-md bg-slate-900/50" />
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-4 transition-opacity">
                            <Button variant="secondary" onClick={handleClick}><UploadIcon /> Trocar</Button>
                            <Button variant="danger" onClick={onImageRemove}><TrashIcon /> Remover</Button>
                        </div>
                    </>
                ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 cursor-pointer p-4" onClick={handleClick}>
                        <UploadIcon className="h-8 w-8 mb-2" />
                        <span className="text-sm text-center">Clique para enviar</span>
                        {isUploading && <p className="text-xs mt-2">Carregando...</p>}
                    </div>
                )}
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileChange}
                    accept="image/png, image/jpeg, image/webp"
                    className="hidden"
                />
            </div>
        </div>
    );
};

export default ImageUpload;

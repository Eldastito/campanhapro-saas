import * as React from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { getElectorResponse } from '../services/geminiService';
import Button from '../components/ui/Button';
import { Send, User, Bot, ArrowLeft } from 'lucide-react';

interface Message {
    role: 'user' | 'bot';
    text: string;
}

const PublicChatPage = ({ onBack }: { onBack: () => void }) => {
    const { campaignDetails } = useSettings();
    const [messages, setMessages] = React.useState<Message[]>([
        { role: 'bot', text: `Olá! Sou o assistente virtual do ${campaignDetails.nomeUrna || 'candidato'}. Como posso te ajudar hoje?` }
    ]);
    const [input, setInput] = React.useState('');
    const [isLoading, setIsLoading] = React.useState(false);
    const scrollRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg = input.trim();
        setInput('');
        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setIsLoading(true);

        const botResponse = await getElectorResponse(userMsg, campaignDetails);
        setMessages(prev => [...prev, { role: 'bot', text: botResponse || "Desculpe, não consegui processar sua mensagem." }]);
        setIsLoading(false);
    };

    return (
        <div className="min-h-screen bg-slate-900 flex flex-col">
            <header className="bg-slate-800 border-b border-slate-700 p-4 flex items-center gap-4">
                <button onClick={onBack} className="text-slate-400 hover:text-white transition-colors">
                    <ArrowLeft />
                </button>
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-sky-500/20 flex items-center justify-center border border-sky-500/30">
                        <Bot className="text-sky-400" />
                    </div>
                    <div>
                        <h1 className="font-bold text-slate-200 leading-tight">Assistente do Candidato</h1>
                        <p className="text-[10px] text-teal-400 font-bold uppercase tracking-wider">Online agora</p>
                    </div>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
                {messages.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] p-3 rounded-2xl flex gap-3 ${
                            m.role === 'user' 
                                ? 'bg-sky-600 text-white rounded-tr-none' 
                                : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-none'
                        }`}>
                            {m.role === 'bot' && <Bot size={18} className="shrink-0 mt-1 text-sky-400" />}
                            <p className="text-sm leading-relaxed">{m.text}</p>
                            {m.role === 'user' && <User size={18} className="shrink-0 mt-1 text-sky-200" />}
                        </div>
                    </div>
                ))}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-slate-800 text-slate-200 border border-slate-700 p-3 rounded-2xl rounded-tl-none flex gap-2">
                            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce [animation-delay:0.2s]"></div>
                            <div className="w-2 h-2 bg-sky-400 rounded-full animate-bounce [animation-delay:0.4s]"></div>
                        </div>
                    </div>
                )}
            </main>

            <footer className="p-4 bg-slate-800 border-t border-slate-700">
                <div className="max-w-4xl mx-auto flex gap-2">
                    <input 
                        type="text" 
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && handleSend()}
                        placeholder="Pergunte sobre propostas, número..."
                        className="flex-1 bg-slate-700 border border-slate-600 rounded-full px-4 py-2 text-slate-200 focus:outline-none focus:border-sky-500 transition-colors"
                    />
                    <Button onClick={handleSend} disabled={isLoading} className="rounded-full w-10 h-10 p-0 flex items-center justify-center">
                        <Send size={18} />
                    </Button>
                </div>
                <p className="text-[10px] text-center text-slate-500 mt-2">
                    IA treinada com base no plano de governo oficial.
                </p>
            </footer>
        </div>
    );
};

export default PublicChatPage;

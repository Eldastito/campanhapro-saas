import { authedFetch } from '../../lib/authedFetch';
import * as React from 'react';
import { Send, AlertCircle } from 'lucide-react';
import Button from '../ui/Button';

interface Props {
  channel: 'whatsapp' | 'instagram';
  to: string;
  contactId: string | null;
  onSent: () => void;
}

const MessageComposer: React.FC<Props> = ({ channel, to, contactId, onSent }) => {
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await authedFetch('/api/v1/channels/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, to, contactId, text }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.error === 'no_consent_and_outside_24h_window') {
          setError('Sem consentimento e fora da janela de 24h — use um template aprovado.');
        } else {
          setError(json.error ?? 'Erro ao enviar');
        }
        return;
      }
      setText('');
      onSent();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-slate-700 p-3 bg-slate-800/50">
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 rounded px-2 py-1 mb-2">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </div>
      )}
      <div className="flex gap-2">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Digite uma mensagem..."
          rows={2}
          className="flex-1 bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 resize-none focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <Button
          variant="primary"
          disabled={!text.trim() || sending}
          onClick={handleSend}
          className="self-end"
        >
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

export default MessageComposer;

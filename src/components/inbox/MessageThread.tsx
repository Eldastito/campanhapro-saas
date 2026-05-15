import * as React from 'react';
import { RefreshCw } from 'lucide-react';

export interface Message {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  channel: string;
  body: string;
  createdAt: string;
  providerMessageId: string | null;
}

interface Props {
  messages: Message[];
  isLoading: boolean;
}

const MessageThread: React.FC<Props> = ({ messages, isLoading }) => {
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500">
        <RefreshCw className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
        Sem mensagens nesta conversa.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-2">
      {messages.map(m => {
        const isInbound = m.direction === 'inbound';
        return (
          <div
            key={m.id}
            className={`flex ${isInbound ? 'justify-start' : 'justify-end'}`}
          >
            <div
              className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm ${
                isInbound
                  ? 'bg-slate-700 text-slate-100 rounded-bl-sm'
                  : 'bg-sky-600 text-white rounded-br-sm'
              }`}
            >
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={`text-[10px] mt-1 ${isInbound ? 'text-slate-400' : 'text-sky-100'}`}>
                {new Date(m.createdAt).toLocaleTimeString('pt-BR', {
                  hour: '2-digit', minute: '2-digit',
                })}
              </p>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
};

export default MessageThread;

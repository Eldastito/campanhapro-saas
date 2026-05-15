import * as React from 'react';
import { MessageCircle, Instagram } from 'lucide-react';

export interface Conversation {
  id: string;
  channel: 'whatsapp' | 'instagram';
  contactId: string | null;
  externalId: string;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  isOpen: boolean;
}

interface Props {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const channelIcon: Record<string, React.ReactNode> = {
  whatsapp: <MessageCircle className="w-4 h-4 text-emerald-400" />,
  instagram: <Instagram className="w-4 h-4 text-pink-400" />,
};

const ConversationList: React.FC<Props> = ({ conversations, selectedId, onSelect }) => {
  if (conversations.length === 0) {
    return (
      <div className="text-center py-10 text-slate-500 text-sm">
        <MessageCircle className="w-10 h-10 mx-auto mb-2 opacity-30" />
        Nenhuma conversa ainda.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-700">
      {conversations.map(c => {
        const isSelected = c.id === selectedId;
        const lastTime = c.lastMessageAt
          ? new Date(c.lastMessageAt).toLocaleString('pt-BR', {
              day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
            })
          : '';
        return (
          <li key={c.id}>
            <button
              className={`w-full text-left p-3 hover:bg-slate-700/50 transition-colors ${
                isSelected ? 'bg-slate-700/60' : ''
              }`}
              onClick={() => onSelect(c.id)}
            >
              <div className="flex items-center gap-2">
                {channelIcon[c.channel]}
                <span className="font-medium text-slate-200 truncate flex-1">
                  {c.externalId}
                </span>
                {c.isOpen && (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                )}
              </div>
              <p className="text-xs text-slate-500 mt-1">{lastTime}</p>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default ConversationList;

import * as React from 'react';
import { Inbox as InboxIcon, RefreshCw } from 'lucide-react';
import ConversationList, { Conversation } from '../components/inbox/ConversationList';
import MessageThread, { Message } from '../components/inbox/MessageThread';
import MessageComposer from '../components/inbox/MessageComposer';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import { useAuth } from '../contexts/AuthContext';

const InboxPage: React.FC = () => {
  const { user } = useAuth();
  const [conversations, setConversations] = React.useState<Conversation[]>([]);
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [loadingConvos, setLoadingConvos] = React.useState(true);
  const [loadingMessages, setLoadingMessages] = React.useState(false);

  const selectedConvo = conversations.find(c => c.id === selectedId);

  const fetchConversations = React.useCallback(async () => {
    if (!user?.campaignId) return;
    setLoadingConvos(true);
    try {
      const res = await fetch('/api/v1/channels/conversations');
      if (res.ok) {
        const json = await res.json();
        setConversations(json.conversations ?? []);
      }
    } catch {
      // empty state
    } finally {
      setLoadingConvos(false);
    }
  }, [user?.campaignId]);

  const fetchMessages = React.useCallback(async (conversationId: string) => {
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/v1/channels/conversations/${conversationId}/messages`);
      if (res.ok) {
        const json = await res.json();
        setMessages(json.messages ?? []);
      }
    } catch {
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  React.useEffect(() => { fetchConversations(); }, [fetchConversations]);

  React.useEffect(() => {
    if (selectedId) fetchMessages(selectedId);
  }, [selectedId, fetchMessages]);

  const handleSent = () => {
    if (selectedId) fetchMessages(selectedId);
    fetchConversations();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-200 flex items-center gap-2">
          <InboxIcon className="w-6 h-6 text-sky-400" />
          Caixa de Entrada Omnichannel
        </h2>
        <Button variant="secondary" onClick={fetchConversations} disabled={loadingConvos}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loadingConvos ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 h-[70vh]">
        <Card className="!p-0 overflow-hidden flex flex-col">
          <div className="p-3 border-b border-slate-700">
            <h3 className="text-sm font-semibold text-slate-300">Conversas</h3>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingConvos ? (
              <div className="flex justify-center p-6 text-slate-500">
                <RefreshCw className="w-5 h-5 animate-spin" />
              </div>
            ) : (
              <ConversationList
                conversations={conversations}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </div>
        </Card>

        <Card className="!p-0 overflow-hidden flex flex-col">
          {!selectedConvo ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Selecione uma conversa para visualizar as mensagens.
            </div>
          ) : (
            <>
              <div className="p-3 border-b border-slate-700">
                <p className="text-sm font-semibold text-slate-200">{selectedConvo.externalId}</p>
                <p className="text-xs text-slate-500 capitalize">{selectedConvo.channel}</p>
              </div>
              <MessageThread messages={messages} isLoading={loadingMessages} />
              <MessageComposer
                channel={selectedConvo.channel}
                to={selectedConvo.externalId}
                contactId={selectedConvo.contactId}
                onSent={handleSent}
              />
            </>
          )}
        </Card>
      </div>
    </div>
  );
};

export default InboxPage;

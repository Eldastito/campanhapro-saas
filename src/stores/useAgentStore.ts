import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface AgentMessage {
  role: 'user' | 'agent';
  content: string;
  metadata?: any;
}

interface ManagerSession {
  intent: string;
  events: any[];
  finalResult: any | null;
  error: string | null;
  // running NÃO é persistido entre montagens — sempre começa false após F5/troca de aba
}

interface AgentState {
  histories: Record<string, AgentMessage[]>; // agent_id -> messages
  activeTab: string;
  warRoomResult: any | null;
  warRoomStep: number;
  managerSession: ManagerSession;
  setHistory: (agentId: string, messages: AgentMessage[]) => void;
  addMessage: (agentId: string, message: AgentMessage) => void;
  setActiveTab: (tab: string) => void;
  setWarRoomResult: (result: any | null) => void;
  setWarRoomStep: (step: number) => void;
  clearHistory: (agentId: string) => void;
  // Manager session
  setManagerIntent: (intent: string) => void;
  setManagerEvents: (events: any[]) => void;
  appendManagerEvent: (event: any) => void;
  setManagerFinal: (final: any | null) => void;
  setManagerError: (err: string | null) => void;
  clearManagerSession: () => void;
}

const emptyManagerSession: ManagerSession = {
  intent: '',
  events: [],
  finalResult: null,
  error: null,
};

export const useAgentStore = create<AgentState>()(
  persist(
    (set) => ({
      histories: {},
      activeTab: 'war-room',
      warRoomResult: null,
      warRoomStep: 0,
      managerSession: emptyManagerSession,
      setHistory: (agentId, messages) =>
        set((state) => ({
          histories: { ...state.histories, [agentId]: messages }
        })),
      addMessage: (agentId, message) =>
        set((state) => {
          const currentHistory = state.histories[agentId] || [];
          return {
            histories: { ...state.histories, [agentId]: [...currentHistory, message] }
          };
        }),
      setActiveTab: (tab) => set({ activeTab: tab }),
      setWarRoomResult: (result) => set({ warRoomResult: result }),
      setWarRoomStep: (step) => set({ warRoomStep: step }),
      clearHistory: (agentId) =>
        set((state) => {
          const newHistories = { ...state.histories };
          delete newHistories[agentId];
          return { histories: newHistories };
        }),
      setManagerIntent: (intent) =>
        set((s) => ({ managerSession: { ...s.managerSession, intent } })),
      setManagerEvents: (events) =>
        set((s) => ({ managerSession: { ...s.managerSession, events } })),
      appendManagerEvent: (event) =>
        set((s) => ({ managerSession: { ...s.managerSession, events: [...s.managerSession.events, event] } })),
      setManagerFinal: (finalResult) =>
        set((s) => ({ managerSession: { ...s.managerSession, finalResult } })),
      setManagerError: (error) =>
        set((s) => ({ managerSession: { ...s.managerSession, error } })),
      clearManagerSession: () => set({ managerSession: emptyManagerSession }),
    }),
    {
      name: 'campanha-pro-agents-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);

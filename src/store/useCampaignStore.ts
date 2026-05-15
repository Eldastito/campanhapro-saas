import { create } from 'zustand';

interface AppState {
  isInitializing: boolean;
  error: string | null;
  sidebarOpen: boolean;
  setInitializing: (val: boolean) => void;
  setError: (error: string | null) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (val: boolean) => void;
}

/**
 * Store global para estado da aplicação Campanha Pró.
 * Gerencia UI, erros globais e estados de carregamento.
 */
export const useCampaignStore = create<AppState>((set) => ({
  isInitializing: true,
  error: null,
  sidebarOpen: false,
  setInitializing: (val) => set({ isInitializing: val }),
  setError: (error) => set({ error }),
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (val) => set({ sidebarOpen: val }),
}));

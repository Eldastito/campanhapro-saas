import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Estado PERSISTIDO da aba Cenários/Simulação. Vive num store global (módulo)
 * + localStorage, então NÃO some ao trocar de sub-aba nem no F5. Guardamos só o
 * modelo de dados (agentes-âncora, conexões, cenário, transcrição, relatório) —
 * a multidão de cidadãos e as posições do grafo são runtime (re-derivadas).
 */

export interface Agent {
  id: string;
  label: string;
  type: 'candidate' | 'leader' | 'voter_group' | 'opponent' | 'ally';
  opinion?: number;
  stubborn?: boolean;
  weight?: number;
  persona?: string;
  voteIntention?: string;
}
export interface Edge {
  source: string; target: string;
  type: 'support' | 'opposition' | 'neutral' | 'undecided';
  weight?: number;
}
export interface TurnAgent { id: string; utterance: string; opinion: number; }
export interface DebateTurn { turn: number; agents: TurnAgent[]; }

interface ScenarioState {
  label: string;
  scenario: string;
  nodes: Agent[];
  edges: Edge[];
  transcript: DebateTurn[];
  report: string | null;
  hasPersonas: boolean;
  electorate: number;        // eleitorado estimado da região (define a amostra)
  setLabel: (v: string) => void;
  setScenario: (v: string) => void;
  setGraph: (nodes: Agent[], edges: Edge[]) => void;
  setNodes: (nodes: Agent[]) => void;
  setEdges: (edges: Edge[]) => void;
  patchNode: (id: string, patch: Partial<Agent>) => void;
  setTranscript: (t: DebateTurn[]) => void;
  setReport: (r: string | null) => void;
  setHasPersonas: (v: boolean) => void;
  setElectorate: (n: number) => void;
  resetDebate: () => void;
}

/**
 * Fórmula da amostra: quantos PONTOS desenhar pra representar o eleitorado.
 * Não dá pra desenhar milhões — então amostramos proporcionalmente, com piso de
 * 140 (cenário mínimo crível) e teto ~420 (performance do canvas). Cada ponto
 * passa a representar `eleitorado / amostra` eleitores. Crescimento sublinear
 * (potência 0.5) → cidade pequena ~140, média ~250, capital chega no teto.
 *   S = clamp( round( 140 * (E / 8000)^0.5 ), 140, 420 )
 */
export function sampleSize(electorate: number): number {
  const E = Math.max(1000, electorate || 0);
  const s = Math.round(140 * Math.pow(E / 8000, 0.5));
  return Math.max(140, Math.min(420, s));
}

const DEFAULT_NODES: Agent[] = [
  { id: 'cand', label: 'Candidato', type: 'candidate', opinion: 1, stubborn: true },
  { id: 'opp', label: 'Adversário', type: 'opponent', opinion: -1, stubborn: true },
  { id: 'vg1', label: 'Centro', type: 'voter_group', opinion: 0.2, weight: 30 },
  { id: 'vg2', label: 'Zona Norte', type: 'voter_group', opinion: -0.3, weight: 40 },
  { id: 'vg3', label: 'Zona Sul', type: 'voter_group', opinion: 0.4, weight: 25 },
  { id: 'ld1', label: 'Liderança', type: 'leader', opinion: 0.6 },
];
const DEFAULT_EDGES: Edge[] = [
  { source: 'vg1', target: 'cand', type: 'undecided' },
  { source: 'vg2', target: 'opp', type: 'support' },
  { source: 'vg3', target: 'cand', type: 'support' },
  { source: 'ld1', target: 'cand', type: 'support' },
];

export const useScenarioStore = create<ScenarioState>()(
  persist(
    (set) => ({
      label: 'Simulação',
      scenario: '',
      nodes: DEFAULT_NODES,
      edges: DEFAULT_EDGES,
      transcript: [],
      report: null,
      hasPersonas: false,
      electorate: 50000,
      setLabel: (label) => set({ label }),
      setScenario: (scenario) => set({ scenario }),
      setGraph: (nodes, edges) => set({ nodes, edges, transcript: [], report: null, hasPersonas: nodes.some((n) => n.persona) }),
      setNodes: (nodes) => set({ nodes }),
      setEdges: (edges) => set({ edges }),
      patchNode: (id, patch) => set((s) => ({ nodes: s.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) })),
      setTranscript: (transcript) => set({ transcript }),
      setReport: (report) => set({ report }),
      setHasPersonas: (hasPersonas) => set({ hasPersonas }),
      setElectorate: (electorate) => set({ electorate }),
      resetDebate: () => set({ transcript: [], report: null }),
    }),
    {
      name: 'campanha-pro-scenarios-storage',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

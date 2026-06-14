/**
 * Calculadora Dinâmica (#134).
 *
 *  GET  /api/v1/calculator/reality   → agrega visits e mostra performance real
 *  POST /api/v1/calculator/analyze   → dispara IA pra comparar planejado vs real
 *
 * O cenário PLANEJADO já está em campaign_configs + scenarios (CalculatorContext).
 * Aqui só calculamos a REALIDADE e disparamos o orquestrador pra interpretar o gap.
 */
import { Router, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fireOrchestration } from '../../../lib/orchestrationTriggers';

const MIN_VISITAS_PARA_ANALISE = 20;

interface BairroStat {
  bairro: string;
  visitas: number;
  votos: number;
  vpf: number;
}

export function createCalculatorRouter(supabase: SupabaseClient): Router {
  const router = Router();

  // ── GET /reality — agrega visits sem chamada de IA (cacheável) ────────
  router.get('/reality', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

      const { data: rows, error } = await supabase
        .from('visits')
        .select('realizada, votos, bairro, data, apoiador, "leaderId"')
        .eq('campaignId', campaignId);
      if (error) return res.status(500).json({ error: error.message });

      const all = (rows || []) as any[];
      const realizadas = all.filter(v => String(v.realizada || '').toLowerCase() === 'sim');
      const total = all.length;
      const realizadasCount = realizadas.length;

      // Vpf real: média de votos por visita realizada (ignora null/0 só se ZERO=desconhecido,
      // mas usuário registra 0 quando ninguém vota. Mantemos 0 no cálculo).
      const votosTotal = realizadas.reduce((s, v) => s + (Number(v.votos) || 0), 0);
      const vpfReal = realizadasCount > 0 ? +(votosTotal / realizadasCount).toFixed(2) : null;

      // Apoiadores: heurística pelo campo 'apoiador' (text). Aceita 'apoiador', 'sim', 'apoia'.
      const apoiadoresCount = realizadas.filter(v => {
        const a = String(v.apoiador || '').toLowerCase().trim();
        return a === 'apoiador' || a === 'sim' || a === 'apoia' || a.includes('apoiad');
      }).length;
      const conversaoTaxa = realizadasCount > 0 ? +(apoiadoresCount / realizadasCount).toFixed(3) : null;

      // Capacidade média diária: realizadas / dias_ativos_distintos
      const diasAtivosSet = new Set(realizadas.map(v => v.data).filter(Boolean));
      const diasAtivos = diasAtivosSet.size;
      const capacidadeDiaMedia = diasAtivos > 0 ? +(realizadasCount / diasAtivos).toFixed(1) : null;

      // Vpf por bairro (apenas bairros com ≥3 visitas pra ter sinal)
      const byBairro = new Map<string, { visitas: number; votos: number }>();
      for (const v of realizadas) {
        const b = String(v.bairro || '').trim() || 'Sem bairro';
        const prev = byBairro.get(b) || { visitas: 0, votos: 0 };
        prev.visitas += 1;
        prev.votos += Number(v.votos) || 0;
        byBairro.set(b, prev);
      }
      const bairros: BairroStat[] = [...byBairro.entries()]
        .filter(([, s]) => s.visitas >= 3)
        .map(([bairro, s]) => ({
          bairro, visitas: s.visitas, votos: s.votos,
          vpf: +(s.votos / s.visitas).toFixed(2),
        }))
        .sort((a, b) => b.vpf - a.vpf);
      const top5 = bairros.slice(0, 5);
      const bottom5 = bairros.slice(-5).reverse();

      const elegivelParaAnalise = realizadasCount >= MIN_VISITAS_PARA_ANALISE;

      return res.json({
        total, realizadas: realizadasCount,
        vpfReal, capacidadeDiaMedia, conversaoTaxa, apoiadoresCount,
        diasAtivos,
        bairros: { top5, bottom5, totalAnalisados: bairros.length },
        elegivelParaAnalise,
        minVisitas: MIN_VISITAS_PARA_ANALISE,
        atualizadoEm: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[calculator] reality:', err);
      return res.status(500).json({ error: err?.message || 'reality_failed' });
    }
  });

  // ── POST /analyze — dispara orquestrador pra interpretar planejado×real ──
  router.post('/analyze', async (req: Request, res: Response) => {
    try {
      const campaignId = (req as any).user?.campaignId;
      if (!campaignId) return res.status(401).json({ error: 'unauthorized' });

      const t = (req as any).user?.userType;
      if (t !== 'Admin' && t !== 'Coordenador' && t !== 'Líder' && t !== 'Candidato' && !(req as any).user?.isSupremeAdmin) {
        return res.status(403).json({ error: 'admin_required' });
      }

      // Pega cenário PLANEJADO da campanha (CalculatorContext salva em calculator_settings)
      const { data: settings } = await supabase
        .from('calculator_settings')
        .select('"calcState", "idealScenarioId"')
        .eq('campaignId', campaignId)
        .maybeSingle();
      const plan: any = (settings as any)?.calcState || {};

      // Reusa o GET /reality pra ter os números
      const realityReq = { user: { campaignId } } as any;
      const realityRes: any = { _payload: null,
        json(p: any) { this._payload = p; return this; },
        status() { return this; }
      };
      // Chamada inline (mesma lógica do handler — duplicada pra evitar HTTP call)
      const { data: rows } = await supabase.from('visits')
        .select('realizada, votos, bairro').eq('campaignId', campaignId);
      const realizadas = (rows || []).filter((v: any) => String(v.realizada || '').toLowerCase() === 'sim');
      const realizadasCount = realizadas.length;
      const votosTotal = realizadas.reduce((s: number, v: any) => s + (Number(v.votos) || 0), 0);
      const vpfReal = realizadasCount > 0 ? +(votosTotal / realizadasCount).toFixed(2) : 0;

      if (realizadasCount < MIN_VISITAS_PARA_ANALISE) {
        return res.status(400).json({
          error: 'sem_dados_suficientes',
          message: `Precisa de pelo menos ${MIN_VISITAS_PARA_ANALISE} visitas realizadas pra análise (você tem ${realizadasCount}).`,
        });
      }

      // Monta intent rico pro orquestrador
      const intent = [
        `Análise da Calculadora de Metas — comparar planejado vs real.`,
        ``,
        `PLANEJADO (do candidato):`,
        `- Meta de votos: ${plan.meta ?? 'não setada'}`,
        `- Votos por família (vpf): ${plan.vpf ?? 'não setado'}`,
        `- Capacidade visitas/dia: ${plan.cap ?? 'não setado'}`,
        `- Dias de visita/semana: ${plan.ds ?? 'não setado'}`,
        `- Buffer: ${plan.buff ?? 0}%`,
        ``,
        `REAL (calculado de ${realizadasCount} visitas realizadas):`,
        `- Vpf real: ${vpfReal}`,
        `- Visitas realizadas: ${realizadasCount}`,
        `- Votos confirmados: ${votosTotal}`,
        ``,
        `OBJETIVO da análise: comparar gap entre planejado e real, calcular projeção realista, e propor 3 ações concretas (ex: realocar líderes, ajustar buffer, focar em bairro X). Use Estrategista + Field Commander.`,
      ].join('\n');

      fireOrchestration(supabase, {
        campaignId,
        intent,
        source: 'calculator',
      });

      void realityRes; // silence
      void realityReq;

      return res.json({
        ok: true,
        queued: true,
        message: 'Análise iniciada. Acompanhe no Quartel General de IA > Histórico.',
      });
    } catch (err: any) {
      console.error('[calculator] analyze:', err);
      return res.status(500).json({ error: err?.message || 'analyze_failed' });
    }
  });

  return router;
}

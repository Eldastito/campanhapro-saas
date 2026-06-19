import Card from '../ui/Card';

interface RankingItem {
  name: string;
  visits: number;
  votes: number;
}

interface RankingsProps {
  bairroRanking: RankingItem[];
  apoiadorRanking: RankingItem[];
  leaderRanking?: { name: string; conversions: number; conversion_rate: number }[];
}

const RankingList = ({ title, data }: { title: string; data: RankingItem[] }) => (
    <div className="flex-1 min-w-full sm:min-w-[300px]">
        <h4 className="font-black text-xs text-slate-500 mb-4 uppercase tracking-[0.2em] border-l-2 border-slate-700 pl-3">{title}</h4>
        <ul className="space-y-2">
            {data.slice(0, 5).map((item, index) => (
                <li key={`${item.name}-${index}`} className="flex justify-between items-center bg-slate-800/40 p-3 rounded-2xl text-sm gap-4 border border-slate-700/30 hover:border-sky-500/30 hover:bg-slate-700/40 transition-all duration-300 group">
                    <div className="flex items-center gap-4 min-w-0 flex-1">
                        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-xl bg-slate-800 border border-slate-700 font-black text-slate-500 group-hover:text-sky-400 transition-colors">
                            {index + 1}
                        </div>
                        <div className="min-w-0">
                            <p className="font-bold text-slate-100 truncate group-hover:text-white transition-colors">{item.name}</p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{item.visits} interações</p>
                        </div>
                    </div>
                    <div className="text-right flex-shrink-0 bg-slate-900/50 px-3 py-1.5 rounded-xl border border-slate-700/50">
                        <p className="font-black text-sky-400 text-lg leading-none">{item.votes}</p>
                        <p className="text-[9px] text-slate-500 font-black uppercase tracking-tighter">votos</p>
                    </div>
                </li>
            ))}
            {data.length === 0 && (
                <div className="py-8 text-center bg-slate-800/20 rounded-2xl border border-dashed border-slate-700">
                    <p className="text-sm text-slate-500 italic">Dados insuficientes para este período.</p>
                </div>
            )}
        </ul>
    </div>
);

const Rankings = ({ bairroRanking, apoiadorRanking, leaderRanking }: RankingsProps) => (
  <Card className="print-break-inside-avoid">
    <div className="flex justify-between items-center mb-6">
      <h3 className="font-bold text-lg text-slate-300">Rankings de Performance</h3>
      <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full font-bold">GAMIFICAÇÃO ATIVA</span>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      <RankingList title="Top Bairros" data={bairroRanking} />
      <RankingList title="Top Apoiadores" data={apoiadorRanking} />
      {leaderRanking && leaderRanking.length > 0 && (
        <div className="md:col-span-2 mt-4 border-t border-slate-700/50 pt-6">
          <h4 className="font-semibold text-slate-400 mb-4 flex items-center gap-2">
            <div className="w-1 h-4 bg-indigo-500 rounded-full"></div>
            Melhores Conversores (Líderes)
          </h4>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {leaderRanking.slice(0, 6).map((item, index) => (
              <li key={item.name} className="flex justify-between items-center bg-indigo-500/5 p-3 rounded-xl border border-indigo-500/10 text-sm group hover:bg-indigo-500/10 transition-all">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-bold text-indigo-400/50 w-6 text-center text-lg">{index + 1}</span>
                  <p className="font-bold text-slate-200 truncate">{item.name}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-black text-indigo-400">{item.conversions} <span className="text-[10px] text-slate-500 uppercase tracking-tighter">votos</span></p>
                  <div className="flex items-center gap-2 justify-end">
                    <div className="w-12 bg-slate-800 h-1 rounded-full overflow-hidden">
                        <div className="bg-emerald-500 h-full" style={{ width: `${Math.min(item.conversion_rate, 100)}%` }}></div>
                    </div>
                    <p className="text-[10px] text-emerald-400 font-black">{item.conversion_rate.toFixed(1)}%</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  </Card>
);

export default Rankings;
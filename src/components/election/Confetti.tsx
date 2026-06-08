import * as React from 'react';

/**
 * Confete CSS puro (sem dependência). Renderiza um burst de papéis caindo
 * enquanto `fire` for true. Usado quando o candidato cruza a linha de chegada.
 */
const COLORS = ['#f43f5e', '#10b981', '#3b82f6', '#f59e0b', '#a855f7', '#eab308', '#22d3ee'];

let injected = false;
function ensureStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.textContent = `
  @keyframes cp-fall { 0%{transform:translateY(-10vh) rotate(0);opacity:1} 100%{transform:translateY(110vh) rotate(720deg);opacity:.9} }
  .cp-piece{position:absolute;top:-10vh;width:10px;height:14px;border-radius:2px;will-change:transform;animation:cp-fall linear forwards}
  `;
  document.head.appendChild(s);
}

const Confetti: React.FC<{ fire: boolean }> = ({ fire }) => {
  ensureStyles();
  const pieces = React.useMemo(() => Array.from({ length: 140 }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.8,
    dur: 2.5 + Math.random() * 2.5,
    color: COLORS[i % COLORS.length],
    size: 0.6 + Math.random() * 0.9,
  })), []);
  if (!fire) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {pieces.map((p, i) => (
        <span key={i} className="cp-piece" style={{
          left: `${p.left}%`,
          background: p.color,
          animationDuration: `${p.dur}s`,
          animationDelay: `${p.delay}s`,
          transform: `scale(${p.size})`,
        }} />
      ))}
    </div>
  );
};

export default Confetti;

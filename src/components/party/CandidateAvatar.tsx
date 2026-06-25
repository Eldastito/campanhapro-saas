import * as React from 'react';

// Retrato do candidato (re-hospedado no Storage, URL assinada vinda do backend).
// Sem foto OU se a imagem falhar ao carregar → cai para as iniciais, nunca quebra
// o layout. Usado na lista/ranking do presidente, no dashboard do candidato e no telão.
const initialsOf = (name: string) =>
  (name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?';

const CandidateAvatar: React.FC<{ name: string; url?: string | null; size?: number; className?: string }> = ({
  name, url, size = 40, className = '',
}) => {
  const [err, setErr] = React.useState(false);
  const box = { width: size, height: size, minWidth: size } as React.CSSProperties;
  if (url && !err) {
    return (
      <img
        src={url}
        alt={name}
        style={box}
        onError={() => setErr(true)}
        className={`rounded-full object-cover bg-white/5 border border-white/10 shrink-0 ${className}`}
      />
    );
  }
  return (
    <div
      style={box}
      className={`rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/30 text-indigo-100 border border-white/10 flex items-center justify-center font-bold shrink-0 ${className}`}
    >
      <span style={{ fontSize: Math.round(size * 0.4) }}>{initialsOf(name)}</span>
    </div>
  );
};

export default CandidateAvatar;

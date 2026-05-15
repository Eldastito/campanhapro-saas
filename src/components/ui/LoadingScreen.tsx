import * as React from 'react';
import { LOGO_MONO_BASE64 } from '../../constants';

const LoadingScreen: React.FC = () => {
  const [message] = React.useState(
    'Aguarde, estamos preparando seu ambiente de campanha...'
  );

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4 text-center">
      <img
        src={LOGO_MONO_BASE64}
        alt="Logo Campanha Pró"
        className="h-16 w-16 mx-auto mb-8 animate-pulse-subtle"
      />

      <div className="flex items-center justify-center space-x-2 mb-8">
        <div className="w-2 h-2 rounded-full bg-slate-500 animate-pulse [animation-delay:-0.3s]" />
        <div className="w-2 h-2 rounded-full bg-slate-500 animate-pulse [animation-delay:-0.15s]" />
        <div className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
      </div>

      <blockquote className="max-w-md animate-fade-in">
        <p className="text-lg italic text-slate-400">"{message}"</p>
      </blockquote>
    </div>
  );
};

export default LoadingScreen;

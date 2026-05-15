import * as React from 'react';

interface TabsProps {
  tabs: string[];
  iconMap?: Record<string, React.ReactNode>;
  children: React.ReactNode;
  mode?: 'url' | 'state';
}

const TabContentLoader: React.FC = () => (
    <div className="flex justify-center items-center py-20">
        <div className="flex items-center justify-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-slate-500 animate-pulse [animation-delay:-0.3s]" />
            <div className="w-3 h-3 rounded-full bg-slate-500 animate-pulse [animation-delay:-0.15s]" />
            <div className="w-3 h-3 rounded-full bg-slate-500 animate-pulse" />
        </div>
    </div>
);

import { useLocation, useNavigate } from 'react-router-dom';

const getSlug = (tab: string) => tab.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '-');

const Tabs: React.FC<TabsProps> = ({ tabs, iconMap = {}, children, mode = 'url' }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [internalIndex, setInternalIndex] = React.useState(0);

  const isUrlMode = mode === 'url';

  // Obter o slug atual da URL apenas se estiver no modo URL
  const pathParts = location.pathname.split('/').filter(Boolean);
  let currentSlug = 'dashboard';
  if (pathParts[0] === 'app' && pathParts.length > 1) {
    currentSlug = pathParts[1];
  }

  let activeIndexFromUrl = tabs.findIndex(tab => getSlug(tab) === currentSlug);
  
  // Se o usuário digitou uma URL inválida ou não permitida, voltamos para a primeira aba disponível (Dashboard)
  if (activeIndexFromUrl === -1 && tabs.length > 0) {
    activeIndexFromUrl = 0;
  }

  const activeIndex = isUrlMode ? activeIndexFromUrl : internalIndex;

  const handleTabChange = (index: number) => {
    if (tabs[index]) {
      if (isUrlMode) {
        const slug = getSlug(tabs[index]);
        navigate(`/app/${slug}`);
      } else {
        setInternalIndex(index);
      }
    }
  };

  const childrenArray = React.Children.toArray(children);

  // A verificação de desenvolvimento foi removida para maior estabilidade
  if (childrenArray.length !== tabs.length) {
    // Este aviso agora aparecerá em todos os ambientes se a contagem não corresponder.
    console.warn(
      `[Tabs] Inconsistência detectada: O número de children (${childrenArray.length}) é diferente do número de tabs (${tabs.length}).`
    );
  }

  const activeChild = childrenArray[activeIndex] ?? null;

  return (
    <div>
      <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-2 mb-4">
        {tabs.map((tab, index) => {
          const isActive = index === activeIndex;
          const icon = iconMap[tab];

          return (
            <button
              key={tab}
              onClick={() => handleTabChange(index)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors shrink-0 whitespace-nowrap ${
                isActive
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800'
              }`}
            >
              {icon && (
                <span className="w-4 h-4 flex items-center justify-center">
                  {icon}
                </span>
              )}
              <span>{tab}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4">
        <React.Suspense fallback={<TabContentLoader />}>
            {activeChild}
        </React.Suspense>
      </div>
    </div>
  );
};


export default Tabs;

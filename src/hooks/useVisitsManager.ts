import * as React from 'react';
import { Visit } from '../types/visits';

export const useVisitsManager = (visits: Visit[]) => {
  const [searchTerm, setSearchTerm] = React.useState('');
  const [sortConfig, setSortConfig] = React.useState<{ key: keyof Visit; direction: 'asc' | 'desc' } | null>(null);

  const filteredVisits = React.useMemo(() => {
    const term = searchTerm.toLowerCase();
    if (!term) return visits;
    
    return visits.filter(visit =>
      visit.resp.toLowerCase().includes(term) ||
      visit.bairro.toLowerCase().includes(term) ||
      visit.apoiador.toLowerCase().includes(term) ||
      (visit.lider && visit.lider.toLowerCase().includes(term))
    );
  }, [visits, searchTerm]);

  const sortedVisits = React.useMemo(() => {
    let sortableVisits = [...filteredVisits];
    if (sortConfig !== null) {
      sortableVisits.sort((a, b) => {
        const aVal = a[sortConfig.key] ?? '';
        const bVal = b[sortConfig.key] ?? '';

        if (aVal < bVal) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aVal > bVal) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    return sortableVisits;
  }, [filteredVisits, sortConfig]);

  return {
    sortedVisits,
    searchTerm,
    setSearchTerm,
    sortConfig,
    setSortConfig,
  };
};
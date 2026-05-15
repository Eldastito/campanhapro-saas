import { Visit } from '../types/visits';
import { Scenario, CalculatorState } from '../types/calculator';

export const getNextElectionDate = (): string => {
  const today = new Date();
  const currentYear = today.getFullYear();
  
  // Tenta eleição deste ano
  for (let year of [currentYear, currentYear + 1]) {
    const election = new Date(year, 9, 1); // Oct 1
    while (election.getDay() !== 0) election.setDate(election.getDate() + 1);
    if (election > today) return election.toISOString().split('T')[0];
  }
  // Fallback
  return `${currentYear + 1}-10-01`;
};

export const calculateDaysRemaining = (electionDate: string): number => {
  if (!electionDate) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const election = new Date(electionDate);
  election.setHours(0,0,0,0);
  const diffTime = election.getTime() - today.getTime();
  return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
};

interface CalculationResult {
  families: number;
  familiesWithBuffer: number;
  weeks: number;
  famPerWeek: number;
  famPerDay: number;
  capacityStatus: 'OK' | 'Quase' | 'Insuficiente';
  capacityColor: string;
}

export const calculateScenarioMetrics = (state: CalculatorState | Scenario, daysRemaining: number): CalculationResult => {
  // If essential params are zero, calculation is not possible.
  if (!state.vpf || !state.ds) {
    return { families: 0, familiesWithBuffer: 0, weeks: 0, famPerWeek: 0, famPerDay: 0, capacityStatus: 'Insuficiente', capacityColor: 'text-red-400' };
  }
  
  const families = Math.ceil(state.meta / state.vpf);
  const familiesWithBuffer = Math.ceil(families * (1 + state.buff / 100));
  const weeks = daysRemaining / 7;

  // If the election is today or has passed, the rate becomes effectively infinite/impossible.
  // We represent this by showing the full amount of families needed, implying they must all be done at once.
  if (daysRemaining <= 0) {
      return { 
          families, 
          familiesWithBuffer, 
          weeks: 0, 
          famPerWeek: familiesWithBuffer, // All families needed "this week"
          famPerDay: familiesWithBuffer, // All families needed "today"
          capacityStatus: 'Insuficiente', 
          capacityColor: 'text-red-400' 
      };
  }

  // A more robust calculation is to find the total working days available and derive rates from that.
  const totalWorkingDays = (daysRemaining / 7) * state.ds;

  // If there are no working days scheduled, the goal is impossible.
  if (totalWorkingDays <= 0) {
      return { families, familiesWithBuffer, weeks, famPerWeek: familiesWithBuffer, famPerDay: familiesWithBuffer, capacityStatus: 'Insuficiente', capacityColor: 'text-red-400' };
  }

  const famPerDay = familiesWithBuffer / totalWorkingDays;
  const famPerWeek = famPerDay * state.ds;
  
  let capacityStatus: 'OK' | 'Quase' | 'Insuficiente' = 'Insuficiente';
  let capacityColor = 'text-red-400';
  if (state.cap >= famPerDay) {
    capacityStatus = 'OK';
    capacityColor = 'text-[#1abc9c]';
  } else if (state.cap >= famPerDay * 0.8) {
    capacityStatus = 'Quase';
    capacityColor = 'text-yellow-400';
  }

  return {
    families,
    familiesWithBuffer,
    weeks,
    famPerWeek: parseFloat(famPerWeek.toFixed(1)),
    famPerDay: parseFloat(famPerDay.toFixed(1)),
    capacityStatus,
    capacityColor,
  };
};

export const downloadFile = (filename: string, content: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
};

export const exportToCsv = (data: any[], filename: string) => {
    if (data.length === 0) {
        alert("Não há dados para exportar.");
        return;
    }
    const headers = Object.keys(data[0]);
    const csvRows = [
        headers.join(','),
        ...data.map(row =>
            headers.map(fieldName => JSON.stringify(row[fieldName])).join(',')
        )
    ];
    downloadFile(filename, csvRows.join('\r\n'), 'text/csv;charset=utf-8;');
};

export const getTodayString = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
};

export const getCurrentScenarioStatus = (visits: Visit[]) => {
  const completedVisits = visits.filter(v => v.realizada === 'sim');
  if (completedVisits.length === 0) {
    return { name: 'N/A', color: 'text-slate-400', avg: 0 };
  }

  const totalVotes = completedVisits.reduce((sum, v) => sum + v.votos, 0);
  const avg = totalVotes / completedVisits.length;

  if (avg >= 7) return { name: 'Ideal (≥7)', color: 'text-[#4ac7f0]', avg };
  if (avg >= 5) return { name: 'Realista (5-6)', color: 'text-[#1abc9c]', avg };
  if (avg >= 3.5) return { name: 'Realista B (3.5-4)', color: 'text-yellow-400', avg };
  return { name: 'Conservador (<3.5)', color: 'text-orange-400', avg };
};

export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
};

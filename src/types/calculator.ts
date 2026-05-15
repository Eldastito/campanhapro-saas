export interface CalculatorState {
  meta: number;
  eleicao: string;
  ds: number; // dias de visita por semana
  vpf: number; // votos por familia
  cap: number; // capacidade de visitas por dia
  buff: number; // buffer percentual
}

export interface Scenario extends CalculatorState {
  id: number;
  name: string;
}

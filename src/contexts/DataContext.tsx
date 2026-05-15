import * as React from 'react';
import { VisitsProvider } from './VisitsContext';
import { CalculatorProvider } from './CalculatorContext';
import { TeamProvider } from './TeamContext';
import { SettingsProvider } from './SettingsContext';
import { FinancialProvider } from './FinancialContext';

// Este componente agora apenas compõe todos os outros provedores de dados.
// Isso melhora a separação de preocupações e o desempenho, pois as atualizações de estado
// são isoladas em seus respectivos contextos.
export const DataProvider = ({ children }: { children?: React.ReactNode }) => {
    return (
        <SettingsProvider>
            <TeamProvider>
                <CalculatorProvider>
                    <VisitsProvider>
                        <FinancialProvider>
                            {children}
                        </FinancialProvider>
                    </VisitsProvider>
                </CalculatorProvider>
            </TeamProvider>
        </SettingsProvider>
    );
};
import { useEffect } from 'react';

/**
 * While a printable report overlay is mounted, adds `report-open` to <body>.
 * The global @media print rules (index.css) use that class to print ONLY the
 * element carrying `.print-root`, hiding the rest of the screen (headers,
 * menus, tables behind). Scoped to body.report-open so normal page printing
 * is unaffected.
 *
 * Usage: call usePrintIsolation() in the report component and put the
 * `print-root` class on its outermost container.
 */
export function usePrintIsolation(): void {
  useEffect(() => {
    document.body.classList.add('report-open');
    return () => document.body.classList.remove('report-open');
  }, []);
}

export default usePrintIsolation;

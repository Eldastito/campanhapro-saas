import * as React from 'react';
import { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  label: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  msg?: string;
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, msg: '' };

  static getDerivedStateFromError(err: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, msg: String(err) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // FIX: Destructure props for cleaner access. The error was reported on this line.
    const { label } = this.props;
    console.error(`[ErrorBoundary:${label}]`, error, info);
  }

  render() {
    if (this.state.hasError) {
      // FIX: Destructure props for cleaner access. The error was reported on this line.
      const { label } = this.props;
      return (
        <div style={{border:'1px solid #f87171',padding:12,margin:'8px 0',borderRadius:8}}>
          <div className="text-red-400 font-bold">
            Erro ao renderizar: {label}
          </div>
          <div className="text-red-300 text-xs break-all">{this.state.msg}</div>
        </div>
      );
    }
    // FIX: Destructure props for cleaner access. The error was reported on this line.
    const { children } = this.props;
    return children;
  }
}

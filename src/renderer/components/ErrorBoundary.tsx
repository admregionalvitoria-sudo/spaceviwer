import React, { Component, ErrorInfo, ReactNode } from 'react';
import { TitleBar } from './ui/TitleBar';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught component exception:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleResetState = () => {
    try {
      sessionStorage.clear();
      localStorage.removeItem('spaceviewer_last_screen');
    } catch {}
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const errorMsg = this.state.error?.message || String(this.state.error || 'Erro desconhecido');
      const componentStack = this.state.errorInfo?.componentStack || '';

      return (
        <div className="h-screen w-screen flex flex-col bg-[#F9FAFB] text-neutral-900 select-none overflow-hidden font-sans">
          <TitleBar subtitle="Recuperação de Erro" />

          <div className="flex-1 flex flex-col items-center justify-center p-6 space-grid-bg overflow-y-auto">
            <div className="bg-white rounded-3xl border border-neutral-300 shadow-2xl p-8 max-w-xl w-full text-center space-y-5 animate-in fade-in zoom-in-95 duration-200">
              <div className="w-14 h-14 rounded-2xl bg-rose-100 border border-rose-300 text-rose-700 flex items-center justify-center mx-auto shadow-sm">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>

              <div className="space-y-1.5">
                <h2 className="font-display font-black text-xl uppercase tracking-wider text-neutral-900">
                  Falha Inesperada na Interface
                </h2>
                <p className="text-xs text-neutral-600 leading-relaxed max-w-md mx-auto">
                  Ocorreu um erro durante a atualização dos elementos de tela. O SpaceViewer evitou o travamento da janela.
                </p>
              </div>

              {/* Error Details */}
              <div className="text-left bg-neutral-100 rounded-xl p-3.5 border border-neutral-250 font-mono text-[11px] text-rose-800 space-y-1 max-h-36 overflow-y-auto select-text">
                <div className="font-bold text-neutral-800">Mensagem:</div>
                <div className="break-all">{errorMsg}</div>
                {componentStack && (
                  <details className="mt-2 text-neutral-500 text-[10px] cursor-pointer">
                    <summary className="font-bold hover:text-neutral-700">Rastreamento do Componente</summary>
                    <pre className="mt-1 whitespace-pre-wrap">{componentStack}</pre>
                  </details>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <button
                  onClick={this.handleReload}
                  className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-neutral-900 hover:bg-neutral-800 active:scale-[0.98] text-white font-mono text-xs font-bold uppercase transition shadow-sm cursor-pointer"
                >
                  Recarregar Interface
                </button>
                <button
                  onClick={this.handleResetState}
                  className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-neutral-100 hover:bg-neutral-200 border border-neutral-300 text-neutral-800 font-mono text-xs font-bold uppercase transition cursor-pointer"
                >
                  Restaurar Modo Padrão
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
export default ErrorBoundary;

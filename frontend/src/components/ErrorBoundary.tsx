import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error inside Bani AI app:', error, errorInfo);
  }

  private handleReset = () => {
    // Fully reset application state by reloading
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.card}>
            <h1 style={styles.title}>ੴ</h1>
            <h2 style={styles.subtitle}>Oops! Something went wrong</h2>
            <p style={styles.text}>
              An unexpected error occurred while rendering the page. This application is optimized for stability, but sometimes memory or Web Speech glitches can occur.
            </p>
            {this.state.error && (
              <pre style={styles.errorLog}>
                {this.state.error.toString()}
              </pre>
            )}
            <button style={styles.button} onClick={this.handleReset}>
              Reset Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#111',
    color: '#fff',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    padding: '2rem'
  },
  card: {
    maxWidth: '500px',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    padding: '2.5rem',
    textAlign: 'center' as const,
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.3)'
  },
  title: {
    fontSize: '3rem',
    color: '#ffd700',
    margin: '0 0 1rem 0'
  },
  subtitle: {
    fontSize: '1.5rem',
    fontWeight: '600' as const,
    marginBottom: '1rem',
    color: '#fff'
  },
  text: {
    fontSize: '0.95rem',
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: '1.6',
    marginBottom: '1.5rem'
  },
  errorLog: {
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    color: '#ff6b6b',
    padding: '1rem',
    borderRadius: '6px',
    fontSize: '0.85rem',
    overflowX: 'auto' as const,
    textAlign: 'left' as const,
    marginBottom: '1.5rem',
    border: '1px solid rgba(255, 107, 107, 0.15)'
  },
  button: {
    padding: '0.75rem 2rem',
    fontSize: '1rem',
    fontWeight: '600' as const,
    backgroundColor: '#ffd700',
    color: '#000',
    border: 'none',
    borderRadius: '25px',
    cursor: 'pointer',
    transition: 'all 0.3s ease',
    boxShadow: '0 4px 15px rgba(255, 215, 0, 0.2)'
  }
};

export default ErrorBoundary;

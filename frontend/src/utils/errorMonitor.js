// Simple error monitoring utility (no external dependencies)
// For production, replace with Sentry: npm install @sentry/react

const ErrorMonitor = {
  errors: [],
  maxErrors: 100,

  init() {
    // Global error handler
    window.onerror = (message, source, lineno, colno, error) => {
      this.captureError({
        type: 'uncaught',
        message,
        source,
        lineno,
        colno,
        stack: error?.stack,
        timestamp: new Date().toISOString()
      });
      return false;
    };

    // Promise rejection handler
    window.onunhandledrejection = (event) => {
      this.captureError({
        type: 'unhandled_rejection',
        message: event.reason?.message || String(event.reason),
        stack: event.reason?.stack,
        timestamp: new Date().toISOString()
      });
    };

    console.log('[ErrorMonitor] Initialized');
  },

  captureError(error) {
    this.errors.push(error);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    // Log to console in development
    console.error('[ErrorMonitor]', error);

    // Send to backend (optional)
    this.sendToBackend(error);
  },

  captureMessage(message, level = 'info') {
    const entry = {
      type: 'message',
      level,
      message,
      timestamp: new Date().toISOString()
    };
    this.errors.push(entry);
    console.log(`[ErrorMonitor][${level}]`, message);
  },

  async sendToBackend(error) {
    try {
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/errors/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...error,
          userAgent: navigator.userAgent,
          url: window.location.href
        })
      });
    } catch (e) {
      // Silent fail - don't create error loops
    }
  },

  getErrors() {
    return this.errors;
  },

  clearErrors() {
    this.errors = [];
  }
};

// Auto-initialize
ErrorMonitor.init();

export default ErrorMonitor;

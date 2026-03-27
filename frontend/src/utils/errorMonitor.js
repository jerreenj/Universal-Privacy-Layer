// Error monitoring utility — no external dependencies, no sensitive data logged
const isDev = process.env.NODE_ENV === "development";

const ErrorMonitor = {
  errors: [],
  maxErrors: 50,

  init() {
    window.onerror = (message, source, lineno, colno, error) => {
      this.captureError({
        type: "uncaught",
        message: this._sanitize(message),
        source,
        lineno,
        colno,
        stack: isDev ? error?.stack : undefined,
        timestamp: new Date().toISOString()
      });
      return false;
    };

    window.onunhandledrejection = (event) => {
      this.captureError({
        type: "unhandled_rejection",
        message: this._sanitize(event.reason?.message || String(event.reason)),
        stack: isDev ? event.reason?.stack : undefined,
        timestamp: new Date().toISOString()
      });
    };
  },

  // Strip any accidental key/seed data before logging
  _sanitize(str = "") {
    return String(str)
      .replace(/0x[a-fA-F0-9]{40,}/g, "[REDACTED_ADDRESS]")
      .replace(/\b([a-z]+ ){11,23}[a-z]+\b/g, "[REDACTED_SEED]")
      .substring(0, 300);
  },

  captureError(error) {
    this.errors.push(error);
    if (this.errors.length > this.maxErrors) this.errors.shift();
    // Only log to console in dev mode
    if (isDev) console.error("[Error]", error.message);
    this.sendToBackend(error);
  },

  captureMessage(message, level = "info") {
    const entry = { type: "message", level, message: this._sanitize(message), timestamp: new Date().toISOString() };
    this.errors.push(entry);
    if (isDev) console.warn("[Monitor]", message);
  },

  async sendToBackend(error) {
    try {
      await fetch(`${process.env.REACT_APP_BACKEND_URL}/api/errors/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...error,
          url: window.location.pathname // no query params or hash
        })
      });
    } catch {
      // silent
    }
  },

  getErrors() { return this.errors; },
  clearErrors() { this.errors = []; }
};

ErrorMonitor.init();
export default ErrorMonitor;

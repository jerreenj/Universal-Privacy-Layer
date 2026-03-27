import axios from "axios";

// Session token stored in memory + sessionStorage — never in localStorage
let _sessionToken = sessionStorage.getItem("_upl_tok") || null;
let _onSessionExpired = null;

export function setSessionToken(t) {
  _sessionToken = t;
  if (t) sessionStorage.setItem("_upl_tok", t);
  else sessionStorage.removeItem("_upl_tok");
  if (t) axios.defaults.headers.common["Authorization"] = `Bearer ${t}`;
  else delete axios.defaults.headers.common["Authorization"];
}

export function getSessionToken() {
  return _sessionToken;
}

export function setOnSessionExpired(callback) {
  _onSessionExpired = callback;
}

// Restore token on page load
if (_sessionToken) axios.defaults.headers.common["Authorization"] = `Bearer ${_sessionToken}`;

// Global interceptor — any 401 from backend clears session and shows gate
axios.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      setSessionToken(null);
      if (_onSessionExpired) _onSessionExpired();
    }
    return Promise.reject(err);
  }
);

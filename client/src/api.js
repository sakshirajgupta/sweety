const SESSION_KEY = 'sweety.token';
function savedToken() {
  try { return window.sessionStorage.getItem(SESSION_KEY); }
  catch { return null; }
}
let token = savedToken();
export function setToken(value) {
  token = value;
  try {
    if (value) window.sessionStorage.setItem(SESSION_KEY, value);
    else window.sessionStorage.removeItem(SESSION_KEY);
  } catch { /* The current page can still work when browser storage is blocked. */ }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      method, signal,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new Error('Cannot reach the server. Check your connection and try again.');
  }
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok || !data) {
    const error = new Error(data?.message || 'The server did not return a valid response. Check that the backend is running and try again.');
    error.status = response.status;
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/register') {
      setToken(null);
      window.dispatchEvent(new Event('session-expired'));
    }
    throw error;
  }
  return data;
}

// Never trust a stored token alone: ask the backend to verify it on reload.
export async function restoreSession({ signal } = {}) {
  if (!token) return null;
  try {
    const data = await api('/auth/me', { signal });
    if (!data.user?.id) throw new Error('Unable to verify your account. Please try again.');
    return data.user;
  } catch (error) {
    if (error.status === 401) return null;
    // Preserve the session on temporary network/server failures, allowing retry.
    throw error;
  }
}

import axios from 'axios'

const base = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api/v1'

// Auth now lives in an httpOnly cookie set by the server - the browser
// attaches it automatically on every request, so we never touch the real
// credential from JS. `lv_authed` (see below) is only a non-sensitive UI
// hint, not the session itself.
export const api = axios.create({ baseURL: base, withCredentials: true })

export function withPasswordHeader(password) {
  const headers = {}
  if (password) headers['x-share-password'] = password
  return { headers }
}

// --- auth UI-state helpers -------------------------------------------------
// The actual session is an httpOnly cookie the client can't read. These
// helpers just track "does the UI think we're logged in" so pages can
// gate themselves without waiting on a network round trip - the server
// still independently re-checks the real cookie on every request.

export function setAuthedHint(email) {
  localStorage.setItem('lv_authed', '1')
  if (email) localStorage.setItem('lv_user_email', email)
  window.dispatchEvent(new Event('auth-change'))
}

export function clearAuthedHint() {
  localStorage.removeItem('lv_authed')
  localStorage.removeItem('lv_user_email')
  window.dispatchEvent(new Event('auth-change'))
}

export function isAuthedHint() {
  return !!localStorage.getItem('lv_authed')
}

// The backend returns errors as { error: { code, message } }.
// This also tolerates the older { error: "string" } shape and blob
// error bodies from responseType: 'blob' requests (e.g. file download).
export function getErrorCode(err) {
  return err?.response?.data?.error?.code
}

export async function getErrorMessage(err) {
  const data = err?.response?.data
  if (data instanceof Blob) {
    try {
      const text = await data.text()
      const parsed = JSON.parse(text)
      return parsed?.error?.message || parsed?.error || err.message
    } catch {
      return err.message
    }
  }
  if (data?.error?.message) return data.error.message
  if (typeof data?.error === 'string') return data.error
  return err.message
}

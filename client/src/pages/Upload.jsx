import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, getErrorMessage, isAuthedHint, clearAuthedHint } from '../lib/api'

function classNames(...classes) { return classes.filter(Boolean).join(' ') }

export default function Upload() {
  const nav = useNavigate()
  const authed = isAuthedHint()
  const [mode, setMode] = useState('text') // 'text' | 'file'
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)

  const [expiryMode, setExpiryMode] = useState('minutes') // 'minutes' | 'datetime'
  const [minutes, setMinutes] = useState(10)
  const [expiresAt, setExpiresAt] = useState('') // datetime-local value

  const [password, setPassword] = useState('')
  const [oneTime, setOneTime] = useState(false)
  const [maxViews, setMaxViews] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const clientShareUrl = useMemo(() => result ? `${window.location.origin}/share/${result.id}` : '', [result])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    setResult(null)

    if (!authed) {
      setSubmitting(false)
      nav('/login')
      return
    }

    try {
      if (mode === 'text' && !text.trim()) {
        setError('Please enter some text or switch to File upload.')
        setSubmitting(false)
        return
      }
      if (mode === 'file' && !file) {
        setError('Please select a file to upload.')
        setSubmitting(false)
        return
      }

      const fd = new FormData()
      if (mode === 'text') fd.append('text', text)
      if (mode === 'file') fd.append('file', file)

      if (expiryMode === 'minutes') {
        fd.append('expiresInMinutes', String(minutes))
      } else if (expiryMode === 'datetime' && expiresAt) {
        // `expiresAt` is a raw <input type="datetime-local"> value with no
        // timezone info - interpreted as-is it would silently mean
        // different instants depending on the visitor's timezone. Convert
        // to a real point in time (in the browser's local timezone, which
        // is what the picker showed) and send that as UTC ISO-8601, since
        // that's the only unambiguous way to communicate "this instant"
        // to the server.
        const asDate = new Date(expiresAt)
        if (Number.isNaN(asDate.getTime())) {
          setError('Please choose a valid expiry date/time.')
          setSubmitting(false)
          return
        }
        fd.append('expiresAt', asDate.toISOString())
      }

      if (password) fd.append('password', password)
      if (oneTime) fd.append('oneTime', 'true')
      if (maxViews) fd.append('maxViews', String(maxViews))

      const { data } = await api.post('/shares', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setResult(data)
    } catch (err) {
      if (err?.response?.status === 401) {
        clearAuthedHint()
        nav('/login')
        return
      }
      setError(await getErrorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const onDelete = async () => {
    if (!result?.id || !result?.manageToken) return
    try {
      await api.delete(`/shares/${result.id}`, { headers: { 'x-manage-token': result.manageToken } })
      alert('Share deleted')
      setResult(null)
      setText('')
      setFile(null)
    } catch (err) {
      alert(await getErrorMessage(err))
    }
  }

  if (!authed) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="card-gradient space-y-4 text-center fade-in">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-500/30">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Create a secure share</h1>
          <p className="text-gray-600">
            You need an account to create uploads. Sign up for free to start sharing securely.
          </p>
          <div className="flex gap-3 justify-center pt-2">
            <Link className="btn" to="/login">Login</Link>
            <Link className="btn" to="/register">Sign up</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="card-gradient fade-in">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Create a secure share</h1>
          <p className="text-gray-600">Upload text or a file and get a shareable link with optional password protection and expiry.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="label">Content Type</label>
            <div className="inline-flex rounded-xl shadow-sm" role="group">
              <button
                type="button"
                onClick={() => setMode('text')}
                className={classNames(
                  'tab-btn rounded-l-xl',
                  mode === 'text' ? 'tab-btn-active' : 'tab-btn-inactive'
                )}
              >
                📝 Text
              </button>
              <button
                type="button"
                onClick={() => setMode('file')}
                className={classNames(
                  'tab-btn rounded-r-xl',
                  mode === 'file' ? 'tab-btn-active' : 'tab-btn-inactive'
                )}
              >
                📎 File
              </button>
            </div>
          </div>

          {mode === 'text' ? (
            <div>
              <label className="label">Text Content</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="input h-48 resize-y font-mono text-sm"
                placeholder="Paste your text here..."
              />
              <p className="text-xs text-gray-500 mt-2">Max 100k characters</p>
            </div>
          ) : (
            <div>
              <label className="label">File Upload</label>
              <div className="relative">
                <input
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-gray-700
                    file:mr-4 file:py-3 file:px-6 file:rounded-lg file:border-0
                    file:text-sm file:font-semibold
                    file:bg-gradient-to-r file:from-indigo-600 file:to-purple-600 file:text-white
                    file:cursor-pointer file:shadow-lg file:shadow-indigo-500/30
                    hover:file:from-indigo-700 hover:file:to-purple-700
                    file:transition-all file:duration-200
                    cursor-pointer"
                />
              </div>
              <p className="text-xs text-gray-500 mt-2">Up to 20 MB by default</p>
            </div>
          )}

          <div>
            <label className="label">Expiry Settings</label>
            <div className="flex gap-3 items-center flex-wrap">
              <select value={expiryMode} onChange={(e) => setExpiryMode(e.target.value)} className="input w-auto">
                <option value="minutes">In minutes</option>
                <option value="datetime">On date/time</option>
              </select>
              {expiryMode === 'minutes' ? (
                <input
                  type="number"
                  min={1}
                  max={60 * 24 * 30}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                  className="input w-32"
                />
              ) : (
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="input flex-1"
                />
              )}
            </div>
            <p className="text-xs text-gray-500 mt-2">Default is 10 minutes if not specified.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">🔒 Password (optional)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="Set a password to protect access"
              />
            </div>
            <div>
              <label className="label">👁️ Max views/downloads (optional)</label>
              <input
                type="number"
                min={1}
                max={1000}
                value={maxViews}
                onChange={(e) => setMaxViews(e.target.value)}
                className="input"
                placeholder="e.g. 5"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border-2 border-indigo-100">
            <input
              id="oneTime"
              type="checkbox"
              checked={oneTime}
              onChange={(e) => setOneTime(e.target.checked)}
              className="w-5 h-5 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500"
            />
            <label htmlFor="oneTime" className="text-sm font-medium text-gray-700 cursor-pointer">
              ⚡ One-time access (link expires after first view/download)
            </label>
          </div>

          {error && <div className="error-box">{error}</div>}

          <button type="submit" className="btn w-full text-base py-3" disabled={submitting}>
            {submitting ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Creating...
              </span>
            ) : '🚀 Create Secure Link'}
          </button>
        </form>
      </div>

      {result && (
        <div className="card-gradient fade-in">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center shadow-lg">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-bold text-gray-900 mb-1">Share created successfully!</h2>
              <p className="text-sm text-gray-600">Your secure link is ready to share</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <div className="label mb-2">Share URL</div>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={clientShareUrl}
                  className="input flex-1 font-mono text-sm bg-gray-50"
                />
                <button
                  className="btn-secondary whitespace-nowrap"
                  onClick={() => {
                    navigator.clipboard.writeText(clientShareUrl)
                    alert('Link copied to clipboard!')
                  }}
                >
                  📋 Copy
                </button>
                <a
                  className="btn-secondary whitespace-nowrap"
                  href={clientShareUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  🔗 Open
                </a>
              </div>
            </div>

            {result.requiresPassword && (
              <div className="badge">
                🔒 Password protected
              </div>
            )}

            {result.manageToken && (
              <div className="flex items-center gap-3 pt-2">
                <button className="btn-secondary" onClick={onDelete}>
                  🗑️ Delete now
                </button>
                <span className="text-xs text-gray-500">
                  Keep this tab open to delete later, or store the manage token securely.
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

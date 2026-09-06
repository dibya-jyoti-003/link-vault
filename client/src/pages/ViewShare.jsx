import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, withPasswordHeader, getErrorCode, getErrorMessage } from '../lib/api'

function formatBytes(bytes) {
  if (bytes === 0 || bytes == null) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

export default function ViewShare() {
  const { id } = useParams()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [needPassword, setNeedPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [copied, setCopied] = useState(false)

  const fetchShare = async (pwd) => {
    setLoading(true)
    setError('')
    setPasswordError('')
    try {
      const { data } = await api.get(`/shares/${id}`, withPasswordHeader(pwd))
      setData(data)
      setNeedPassword(false)
      setPasswordError('')
    } catch (err) {
      const code = getErrorCode(err)
      if (code === 'PASSWORD_REQUIRED') {
        setNeedPassword(true)
      } else if (code === 'INVALID_PASSWORD') {
        setNeedPassword(true)
        setPasswordError('Incorrect password. Please try again.')
      } else if (code === 'RATE_LIMITED') {
        setNeedPassword(true)
        setPasswordError(await getErrorMessage(err))
      } else if (err?.response?.status === 404) {
        setError('This share does not exist.')
      } else if (err?.response?.status === 410) {
        setError(await getErrorMessage(err) || 'Link expired or limit reached')
      } else {
        setError(await getErrorMessage(err))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchShare()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const onDownload = async () => {
    try {
      // The backend streams the file bytes directly (it's the sole,
      // authoritative access point - see server/src/routes/shares.js),
      // so we pull it down as a blob and trigger a save-as locally
      // rather than following a separate URL.
      const res = await api.get(`/shares/${id}/download`, {
        ...withPasswordHeader(password),
        responseType: 'blob',
      })
      const blob = new Blob([res.data])
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = data?.fileName || 'download'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      alert(await getErrorMessage(err))
    }
  }

  const onCopy = () => {
    navigator.clipboard.writeText(data.text || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const expiresText = useMemo(() => data?.expiresAt ? new Date(data.expiresAt).toLocaleString() : '', [data])

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {loading && (
        <div className="card-gradient text-center py-12 loading fade-in">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-xl animate-pulse">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <p className="text-gray-600 font-medium">Loading share...</p>
        </div>
      )}

      {!loading && error && (
        <div className="card-gradient text-center py-12 fade-in">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center shadow-xl">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Error</h2>
          <p className="text-red-600 font-medium">{error}</p>
        </div>
      )}

      {!loading && !error && needPassword && (
        <div className="card-gradient fade-in">
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-xl">
              <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Password required</h2>
            <p className="text-gray-600">This share is protected. Enter the password to access it.</p>
          </div>

          {passwordError && (
            <div className="error-box text-sm mb-4">
              {passwordError}
            </div>
          )}

          <div className="flex gap-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input flex-1"
              placeholder="Enter password"
              onKeyDown={(e) => e.key === 'Enter' && fetchShare(password)}
            />
            <button className="btn" onClick={() => fetchShare(password)}>
              🔓 Unlock
            </button>
          </div>
        </div>
      )}

      {!loading && !error && !needPassword && data && (
        <div className="card-gradient space-y-6 fade-in">
          <div className="flex items-center justify-between pb-4 border-b border-gray-200">
            <div>
              <div className="badge mb-2">
                {data.type === 'text' ? '📝 Text Share' : '📎 File Share'}
              </div>
              <p className="text-sm text-gray-600">
                ⏰ Expires: <span className="font-medium">{expiresText || '—'}</span>
              </p>
            </div>
          </div>

          {data.type === 'text' ? (
            <div className="space-y-4">
              <div className="flex gap-3">
                <button
                  className={copied ? "btn-secondary" : "btn"}
                  onClick={onCopy}
                >
                  {copied ? '✅ Copied!' : '📋 Copy Text'}
                </button>
              </div>
              <pre className="code-block whitespace-pre-wrap break-words">{data.text}</pre>
              {data.remainingViews != null && (
                <div className="text-sm text-gray-600 bg-indigo-50 p-3 rounded-lg border border-indigo-100">
                  👁️ Remaining views: <span className="font-bold text-indigo-700">{data.remainingViews}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-6 rounded-xl border-2 border-indigo-100">
                <div className="flex items-start gap-4">
                  <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg flex-shrink-0">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-lg text-gray-900 mb-1 truncate">{data.fileName}</h3>
                    <div className="flex flex-wrap gap-3 text-sm text-gray-600">
                      <span className="badge">{formatBytes(data.size)}</span>
                      <span className="badge">{data.mimeType}</span>
                    </div>
                  </div>
                </div>
              </div>

              <button className="btn w-full text-base py-3" onClick={onDownload}>
                ⬇️ Download File
              </button>

              {data.remainingDownloads != null && (
                <div className="text-sm text-gray-600 bg-indigo-50 p-3 rounded-lg border border-indigo-100 text-center">
                  ⬇️ Remaining downloads: <span className="font-bold text-indigo-700">{data.remainingDownloads}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

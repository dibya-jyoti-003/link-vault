import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, getErrorMessage, isAuthedHint, clearAuthedHint } from '../lib/api'

function format(dt) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString()
}

export default function MyShares() {
  const nav = useNavigate()
  const authed = isAuthedHint()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [shares, setShares] = useState([])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/shares/me')
      setShares(data.shares || [])
    } catch (err) {
      if (err?.response?.status === 401) {
        clearAuthedHint()
        nav('/login')
        return
      }
      setError(await getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authed) {
      nav('/login')
      return
    }
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shareOrigin = useMemo(() => window.location.origin, [])

  const onDelete = async (id) => {
    if (!confirm('Delete this share permanently?')) return
    try {
      await api.delete(`/shares/${id}`)
      await load()
    } catch (err) {
      alert(await getErrorMessage(err))
    }
  }

  const onCopy = (url) => {
    navigator.clipboard.writeText(url)
    alert('Link copied to clipboard!')
  }

  return (
    <div className="space-y-6">
      <div className="card-gradient flex items-center justify-between fade-in">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">My Shares</h1>
          <p className="text-gray-600">Manage your active links</p>
        </div>
        <Link to="/" className="btn">
          ➕ New share
        </Link>
      </div>

      {loading && (
        <div className="card-gradient text-center py-12 loading fade-in">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-xl animate-pulse">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
          </div>
          <p className="text-gray-600 font-medium">Loading shares...</p>
        </div>
      )}

      {!loading && error && (
        <div className="error-box fade-in">{error}</div>
      )}

      {!loading && !error && shares.length === 0 && (
        <div className="card-gradient text-center py-12 fade-in">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-gray-400 to-gray-600 flex items-center justify-center shadow-xl">
            <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">No shares yet</h2>
          <p className="text-gray-600 mb-4">Create your first secure share to get started</p>
          <Link to="/" className="btn">
            ➕ Create Share
          </Link>
        </div>
      )}

      {!loading && !error && shares.length > 0 && (
        <div className="space-y-3 fade-in">
          {shares.map((s) => {
            const url = `${shareOrigin}/share/${s.shortId}`
            const counts = s.type === 'text'
              ? `${s.views}${s.maxViews ? `/${s.maxViews}` : ''}`
              : `${s.downloadCount}${s.maxViews ? `/${s.maxViews}` : ''}`

            return (
              <div key={s.shortId} className="card-gradient hover:shadow-2xl transition-shadow duration-200">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0 ${s.type === 'text'
                      ? 'bg-gradient-to-br from-blue-500 to-cyan-600'
                      : 'bg-gradient-to-br from-purple-500 to-pink-600'
                    }`}>
                    {s.type === 'text' ? (
                      <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    ) : (
                      <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-gray-900 mb-1 truncate">
                          {s.type === 'file' && s.file?.originalName ? s.file.originalName : s.shortId}
                        </h3>
                        <p className="text-xs text-gray-500 truncate font-mono">{url}</p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <button
                          className="btn-secondary text-xs py-1.5 px-3"
                          onClick={() => onCopy(url)}
                          title="Copy link"
                        >
                          📋
                        </button>
                        <button
                          className="btn-secondary text-xs py-1.5 px-3 hover:border-red-300 hover:text-red-700"
                          onClick={() => onDelete(s.shortId)}
                          title="Delete share"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className="badge">
                        {s.type === 'text' ? '👁️' : '⬇️'} {counts} {s.type === 'text' ? 'views' : 'downloads'}
                      </span>
                      <span className="badge">
                        ⏰ {format(s.expiresAt)}
                      </span>
                      {s.oneTime && (
                        <span className="badge bg-gradient-to-r from-amber-100 to-orange-100 text-amber-700 border-amber-200">
                          ⚡ One-time
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

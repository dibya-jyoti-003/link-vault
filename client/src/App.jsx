import { useState, useEffect } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import Upload from './pages/Upload.jsx'
import ViewShare from './pages/ViewShare.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import MyShares from './pages/MyShares.jsx'
import { api, isAuthedHint, setAuthedHint, clearAuthedHint } from './lib/api'

export default function App() {
  const [authed, setAuthed] = useState(isAuthedHint())
  const [userEmail, setUserEmail] = useState(localStorage.getItem('lv_user_email'))

  useEffect(() => {
    // Listen for auth changes from login/register/logout
    const handleAuthChange = () => {
      setAuthed(isAuthedHint())
      setUserEmail(localStorage.getItem('lv_user_email'))
    }

    window.addEventListener('auth-change', handleAuthChange)
    return () => window.removeEventListener('auth-change', handleAuthChange)
  }, [])

  useEffect(() => {
    // `lv_authed` is only a UI hint for the very first paint - it can go
    // stale (e.g. the session cookie expired, or was cleared in another
    // tab). Reconcile it against the real session on load so the nav bar
    // reflects actual auth state rather than a possibly-outdated guess.
    let cancelled = false
    api.get('/auth/me')
      .then(({ data }) => {
        if (cancelled) return
        if (data?.user?.email) setAuthedHint(data.user.email)
      })
      .catch((err) => {
        if (cancelled) return
        if (err?.response?.status === 401) clearAuthedHint()
      })
    return () => { cancelled = true }
  }, [])

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout')
    } catch {
      // Even if the request fails, drop the local UI hint below - the
      // cookie will simply expire on its own.
    }
    clearAuthedHint()
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen">
      <nav className="glass sticky top-0 z-50 border-b border-white/20">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30 group-hover:shadow-xl group-hover:shadow-indigo-500/40 transition-all duration-200">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <span className="text-xl font-bold text-gradient">LinkVault</span>
          </Link>
          <div className="flex items-center gap-4">
            {authed ? (
              <>
                {userEmail && (
                  <span className="text-sm text-gray-600 hidden sm:inline">
                    👤 {userEmail}
                  </span>
                )}
                <Link to="/me" className="text-sm font-medium text-gray-700 hover:text-indigo-600 transition-colors">
                  My Shares
                </Link>
                <button
                  className="text-sm font-medium text-gray-700 hover:text-red-600 transition-colors"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="text-sm font-medium text-gray-700 hover:text-indigo-600 transition-colors">
                  Login
                </Link>
                <Link to="/register" className="btn text-sm py-2 px-4">
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<Upload />} />
          <Route path="/share/:id" element={<ViewShare />} />
          <Route path="/me" element={<MyShares />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
        </Routes>
      </div>
    </div>
  )
}

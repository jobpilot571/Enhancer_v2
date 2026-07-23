import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  clearAuthStorage,
  fetchMe,
  getAuthStatus,
  getAuthToken,
  getStoredUser,
  login as apiLogin,
  loginLocalDev as apiLoginLocalDev,
  loginWithGoogle as apiLoginWithGoogle,
  logout as apiLogout,
  setStoredUser,
  signup as apiSignup,
  verifyOtp as apiVerifyOtp,
  resendOtp as apiResendOtp,
} from '../api/auth'
import { isLocalDevHost } from '../utils/googleAuthUi'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function boot() {
      const token = getAuthToken()
      if (token) {
        try {
          const data = await fetchMe()
          if (!cancelled) setUser(data.user)
        } catch {
          if (!cancelled) {
            clearAuthStorage()
            setUser(null)
          }
        }
        if (!cancelled) setLoading(false)
        return
      }

      // Local-only: auto sign-in as unlimited developer when server allows it
      if (isLocalDevHost()) {
        try {
          const status = await getAuthStatus()
          if (status?.localDevAuth) {
            const data = await apiLoginLocalDev()
            if (!cancelled && data?.user) setUser(data.user)
          }
        } catch {
          /* server may be down or LOCAL_DEV_AUTH off — fall through */
        }
      }

      if (!cancelled) setLoading(false)
    }

    boot()
    return () => {
      cancelled = true
    }
  }, [])

  const signup = useCallback(async (payload) => {
    const data = await apiSignup(payload)
    if (data.user && data.token && !data.needsVerification) {
      setUser(data.user)
      setStoredUser(data.user)
    }
    return data
  }, [])

  const login = useCallback(async (payload) => {
    const data = await apiLogin(payload)
    if (data.user && !data.needsVerification) {
      setUser(data.user)
      setStoredUser(data.user)
    }
    return data
  }, [])

  const loginWithGoogle = useCallback(async (credential) => {
    const data = await apiLoginWithGoogle(credential)
    if (data.user && !data.needsVerification) {
      setUser(data.user)
      setStoredUser(data.user)
    }
    return data
  }, [])

  const loginLocalDev = useCallback(async () => {
    const data = await apiLoginLocalDev()
    if (data.user) {
      setUser(data.user)
      setStoredUser(data.user)
    }
    return data
  }, [])

  const verifyOtp = useCallback(async (payload) => {
    const data = await apiVerifyOtp(payload)
    if (data.user) {
      setUser(data.user)
      setStoredUser(data.user)
    }
    return data
  }, [])

  const resendOtp = useCallback(async (payload) => apiResendOtp(payload), [])

  const logout = useCallback(async () => {
    await apiLogout()
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const data = await fetchMe()
    setUser(data.user)
    return data.user
  }, [])

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user?.emailVerified),
      signup,
      login,
      loginWithGoogle,
      loginLocalDev,
      verifyOtp,
      resendOtp,
      logout,
      refreshUser,
    }),
    [user, loading, signup, login, loginWithGoogle, loginLocalDev, verifyOtp, resendOtp, logout, refreshUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

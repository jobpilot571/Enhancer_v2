import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  clearAuthStorage,
  fetchMe,
  getAuthToken,
  getStoredUser,
  login as apiLogin,
  loginWithGoogle as apiLoginWithGoogle,
  logout as apiLogout,
  setStoredUser,
  signup as apiSignup,
  verifyOtp as apiVerifyOtp,
  resendOtp as apiResendOtp,
} from '../api/auth'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser())
  const [loading, setLoading] = useState(() => Boolean(getAuthToken()))

  useEffect(() => {
    const token = getAuthToken()
    if (!token) {
      setLoading(false)
      return
    }

    let cancelled = false
    fetchMe()
      .then((data) => {
        if (!cancelled) setUser(data.user)
      })
      .catch((err) => {
        if (!cancelled) {
          if (err?.needsVerification) {
            clearAuthStorage()
          } else {
            clearAuthStorage()
          }
          setUser(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const signup = useCallback(async (payload) => apiSignup(payload), [])

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
      verifyOtp,
      resendOtp,
      logout,
      refreshUser,
    }),
    [user, loading, signup, login, loginWithGoogle, verifyOtp, resendOtp, logout, refreshUser]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

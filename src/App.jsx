import { Navigate, Routes, Route, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import GlobalAiAssistant from './components/GlobalAiAssistant'
import HomePage from './pages/HomePage'
import ResumeEnhancerPage from './pages/ResumeEnhancerPage'
import ResumeBuilderPage from './pages/ResumeBuilderPage'
import JDTailoredResumePage from './pages/JDTailoredResumePage'
import AdminPage from './pages/AdminPage'
import LoginPage from './pages/LoginPage'
import SignupPage from './pages/SignupPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
import BillingCheckoutPage from './pages/BillingCheckoutPage'
import BillingSuccessPage from './pages/BillingSuccessPage'
import useScrollReveal, { useScrollToHash } from './hooks/useScrollReveal'
import { useAuth } from './context/AuthContext'

function RequireAuth({ children }) {
  const { loading, isAuthenticated } = useAuth()
  const location = useLocation()

  if (loading) return null

  if (!isAuthenticated) {
    const next = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }

  return children
}

export default function App() {
  useScrollReveal()
  useScrollToHash()
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')
  const isAuthPage = ['/login', '/signup', '/verify'].includes(location.pathname)
  const isServiceWorkspace = location.pathname.startsWith('/services/')
  const isHome = location.pathname === '/'

  if (isAdmin) {
    return (
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    )
  }

  if (isAuthPage) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/verify" element={<VerifyEmailPage />} />
      </Routes>
    )
  }

  return (
    <div className={`app${isServiceWorkspace ? ' app--pro-workspace' : ''}${isHome ? ' app--pro-home' : ''}`}>
      <div className="app-shell">
        <Navbar />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route
            path="/services/resume-enhancer"
            element={<RequireAuth><ResumeEnhancerPage /></RequireAuth>}
          />
          <Route
            path="/services/resume-builder"
            element={<RequireAuth><ResumeBuilderPage /></RequireAuth>}
          />
          <Route
            path="/services/jd-tailored-resume"
            element={<RequireAuth><JDTailoredResumePage /></RequireAuth>}
          />
          <Route path="/billing/checkout" element={<BillingCheckoutPage />} />
          <Route path="/billing/success" element={<BillingSuccessPage />} />
        </Routes>
        {!isServiceWorkspace && <Footer />}
      </div>
      <GlobalAiAssistant />
    </div>
  )
}

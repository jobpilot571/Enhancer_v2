import { Routes, Route, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import HomePage from './pages/HomePage'
import ResumeEnhancerPage from './pages/ResumeEnhancerPage'
import ResumeBuilderPage from './pages/ResumeBuilderPage'
import JDTailoredResumePage from './pages/JDTailoredResumePage'
import AdminPage from './pages/AdminPage'
import useScrollReveal, { useScrollToHash } from './hooks/useScrollReveal'

export default function App() {
  useScrollReveal()
  useScrollToHash()
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')

  if (isAdmin) {
    return (
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    )
  }

  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/services/resume-enhancer" element={<ResumeEnhancerPage />} />
        <Route path="/services/resume-builder" element={<ResumeBuilderPage />} />
        <Route path="/services/jd-tailored-resume" element={<JDTailoredResumePage />} />
      </Routes>
      <Footer />
    </>
  )
}

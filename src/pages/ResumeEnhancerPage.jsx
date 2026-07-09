import { Link } from 'react-router-dom'
import ResumeEnhancer from '../components/services/ResumeEnhancer'

export default function ResumeEnhancerPage() {
  return (
    <main className="service-page">
      <div className="container">
        <Link to="/#services" className="service-page__back service-page__back--icon" aria-label="Back to Services">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </Link>
        <ResumeEnhancer />
      </div>
    </main>
  )
}

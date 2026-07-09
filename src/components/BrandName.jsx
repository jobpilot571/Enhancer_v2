export default function BrandName({ className = '' }) {
  return (
    <span className={`brand-name ${className}`}>
      <span className="brand-name__job">JoB</span>
      <span className="brand-name__pilot">Pilot</span>
      <span className="brand-name__ai">.AI</span>
    </span>
  )
}

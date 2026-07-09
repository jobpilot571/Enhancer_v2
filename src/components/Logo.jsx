export default function Logo({ size = 36, className = '' }) {
  return (
    <img
      src="/logo.png"
      alt="JoBPilot.AI"
      width={size}
      height={size}
      className={`logo-img ${className}`}
      draggable={false}
    />
  )
}

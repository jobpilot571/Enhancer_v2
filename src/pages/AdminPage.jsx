import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import BrandName from '../components/BrandName'
import Logo from '../components/Logo'
import { RESUME_TEMPLATES } from '../data/resumeTemplates'
import {
  getAdminToken,
  getAdminStatus,
  adminLogin,
  adminLogout,
  adminMe,
  fetchAdminTemplates,
  uploadTemplateSample,
  deleteTemplateSample,
  fetchAdminPricing,
  saveAdminPricing,
  getSampleFileUrl,
  fetchComplimentaryEmails,
  addComplimentaryEmail,
  removeComplimentaryEmail,
} from '../api/admin'

const TABS = [
  { id: 'templates', label: 'Templates' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'access', label: 'Free access' },
]

function formatBytes(n) {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function AdminLogin({ onSuccess }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [configured, setConfigured] = useState(null)

  useEffect(() => {
    getAdminStatus()
      .then((s) => setConfigured(s.configured))
      .catch(() => setConfigured(false))
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await adminLogin(password)
      onSuccess()
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-login">
      <div className="admin-login__card">
        <div className="admin-login__brand">
          <Logo size={36} />
          <span><BrandName /></span>
        </div>
        <h1 className="admin-login__title">Admin console</h1>
        <p className="admin-login__desc">Private access for template samples and pricing.</p>

        {configured === false && (
          <p className="admin-banner admin-banner--warn">
            Set <code>ADMIN_PASSWORD</code> in the server <code>.env</code>, then restart the API.
          </p>
        )}

        <form onSubmit={handleSubmit} className="admin-login__form">
          <label className="admin-field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={configured === false}
              required
            />
          </label>
          {error && <p className="admin-error">{error}</p>}
          <button type="submit" className="btn btn--primary btn--full" disabled={loading || configured === false}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <Link to="/" className="admin-login__back">← Back to site</Link>
      </div>
    </div>
  )
}

function TemplatesPanel({ templates, catalog, onRefresh }) {
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function handleUpload(templateId, file) {
    if (!file) return
    setBusyId(templateId)
    setError('')
    setMessage('')
    try {
      await uploadTemplateSample(templateId, file)
      setMessage(`Sample uploaded for ${catalog[templateId]?.name || templateId}`)
      await onRefresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId('')
    }
  }

  async function handleDelete(templateId) {
    if (!confirm('Remove this sample document?')) return
    setBusyId(templateId)
    setError('')
    setMessage('')
    try {
      await deleteTemplateSample(templateId)
      setMessage('Sample removed')
      await onRefresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId('')
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel__header">
        <div>
          <h2>Template samples</h2>
          <p>Upload a real DOCX or PDF per template so the builder picker shows a better preview.</p>
        </div>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {message && <p className="admin-banner admin-banner--ok">{message}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Template</th>
              <th>Sample</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.map((tpl) => {
              const meta = catalog[tpl.id] || { name: tpl.id, description: '' }
              const sample = tpl.sample
              const busy = busyId === tpl.id
              return (
                <tr key={tpl.id}>
                  <td>
                    <div className="admin-tpl-name">
                      <span
                        className="admin-tpl-swatch"
                        style={{ background: `#${tpl.accent || '16c784'}` }}
                        aria-hidden
                      />
                      <div>
                        <strong>{meta.name}</strong>
                        <span className="admin-muted">{meta.description || tpl.id}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    {sample ? (
                      <div className="admin-sample-meta">
                        <a href={getSampleFileUrl(tpl.id)} target="_blank" rel="noreferrer">
                          {sample.fileName}
                        </a>
                        <span className="admin-muted">
                          {sample.fileType?.toUpperCase()} · {formatBytes(sample.size)}
                        </span>
                      </div>
                    ) : (
                      <span className="admin-muted">No sample yet</span>
                    )}
                  </td>
                  <td>
                    <div className="admin-actions">
                      <label className={`btn btn--outline btn--sm ${busy ? 'is-disabled' : ''}`}>
                        {busy ? 'Working…' : sample ? 'Replace' : 'Upload'}
                        <input
                          type="file"
                          accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                          hidden
                          disabled={busy}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            e.target.value = ''
                            handleUpload(tpl.id, file)
                          }}
                        />
                      </label>
                      {sample && (
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={busy}
                          onClick={() => handleDelete(tpl.id)}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PricingPanel({ initialPlans, onSaved }) {
  const [plans, setPlans] = useState(initialPlans)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    setPlans(initialPlans)
  }, [initialPlans])

  function updatePlan(index, patch) {
    setPlans((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
  }

  function updateFeature(planIndex, featureIndex, value) {
    setPlans((prev) =>
      prev.map((p, i) => {
        if (i !== planIndex) return p
        const features = [...p.features]
        features[featureIndex] = value
        return { ...p, features }
      }),
    )
  }

  function addFeature(planIndex) {
    setPlans((prev) =>
      prev.map((p, i) => (i === planIndex ? { ...p, features: [...p.features, ''] } : p)),
    )
  }

  function removeFeature(planIndex, featureIndex) {
    setPlans((prev) =>
      prev.map((p, i) => {
        if (i !== planIndex) return p
        return { ...p, features: p.features.filter((_, fi) => fi !== featureIndex) }
      }),
    )
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const cleaned = plans.map((p) => ({
        ...p,
        features: p.features.map((f) => f.trim()).filter(Boolean),
      }))
      const saved = await saveAdminPricing(cleaned)
      setPlans(saved.plans)
      onSaved?.(saved.plans)
      setMessage('Pricing saved — homepage will use these values.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="admin-panel" onSubmit={handleSave}>
      <div className="admin-panel__header">
        <div>
          <h2>Pricing plans</h2>
          <p>Edit amounts and copy shown on the public pricing section.</p>
        </div>
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save pricing'}
        </button>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {message && <p className="admin-banner admin-banner--ok">{message}</p>}

      <div className="admin-pricing-grid">
        {plans.map((plan, pi) => (
          <div key={plan.id || pi} className="admin-plan-card">
            <label className="admin-field">
              <span>Name</span>
              <input
                value={plan.name}
                onChange={(e) => updatePlan(pi, { name: e.target.value })}
                required
              />
            </label>
            <div className="admin-field-row">
              <label className="admin-field">
                <span>Price</span>
                <input
                  value={plan.price}
                  onChange={(e) => updatePlan(pi, { price: e.target.value })}
                  required
                />
              </label>
              <label className="admin-field">
                <span>Period</span>
                <input
                  value={plan.period}
                  onChange={(e) => updatePlan(pi, { period: e.target.value })}
                  placeholder="/month"
                />
              </label>
            </div>
            <label className="admin-field">
              <span>Description</span>
              <textarea
                rows={2}
                value={plan.desc}
                onChange={(e) => updatePlan(pi, { desc: e.target.value })}
              />
            </label>
            <label className="admin-field">
              <span>CTA label</span>
              <input
                value={plan.cta}
                onChange={(e) => updatePlan(pi, { cta: e.target.value })}
              />
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={Boolean(plan.featured)}
                onChange={(e) => updatePlan(pi, { featured: e.target.checked })}
              />
              Featured (Most Popular)
            </label>
            <div className="admin-features">
              <div className="admin-features__head">
                <span>Features</span>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => addFeature(pi)}>
                  Add
                </button>
              </div>
              {plan.features.map((f, fi) => (
                <div key={fi} className="admin-feature-row">
                  <input
                    value={f}
                    onChange={(e) => updateFeature(pi, fi, e.target.value)}
                    placeholder="Feature"
                  />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => removeFeature(pi, fi)}
                    aria-label="Remove feature"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </form>
  )
}

const PLAN_TYPE_OPTIONS = [
  { id: 'employee', label: 'Employee' },
  { id: 'friend', label: 'Friend' },
  { id: 'admin', label: 'Admin' },
  { id: 'student', label: 'Student' },
]

function ComplimentaryPanel({ entries, onChange, onSessionExpired }) {
  const [email, setEmail] = useState('')
  const [planType, setPlanType] = useState('employee')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function handleAdd(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const res = await addComplimentaryEmail(email, planType)
      setEmail('')
      setMessage(
        res.message
          || `${res.entry.email} set to ${res.entry.planTypeLabel || planType} plan (unlimited)`,
      )
      const list = await fetchComplimentaryEmails()
      onChange?.(list.entries || [])
    } catch (err) {
      if (/session expired/i.test(err.message || '')) {
        onSessionExpired?.()
        return
      }
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(targetEmail) {
    if (!confirm(`Remove free paid access for ${targetEmail}?`)) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await removeComplimentaryEmail(targetEmail)
      setMessage(`Removed ${targetEmail}`)
      const list = await fetchComplimentaryEmails()
      onChange?.(list.entries || [])
    } catch (err) {
      if (/session expired/i.test(err.message || '')) {
        onSessionExpired?.()
        return
      }
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel__header">
        <div>
          <h2>Free paid access</h2>
          <p>
            Grant unlimited access and choose a plan type label (Employee, Friend, Admin, or Student)
            shown instead of Free plan.
          </p>
        </div>
      </div>

      {error && <p className="admin-error">{error}</p>}
      {message && <p className="admin-banner admin-banner--ok">{message}</p>}

      <form className="admin-access-form" onSubmit={handleAdd}>
        <label className="admin-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@example.com"
            required
            disabled={busy}
          />
        </label>
        <label className="admin-field">
          <span>Plan type</span>
          <select
            value={planType}
            onChange={(e) => setPlanType(e.target.value)}
            disabled={busy}
            required
          >
            {PLAN_TYPE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Grant access'}
        </button>
      </form>

      <div className="admin-table-wrap" style={{ marginTop: 20 }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Plan type</th>
              <th>Added</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <span className="admin-muted">No complimentary emails yet.</span>
                </td>
              </tr>
            )}
            {entries.map((entry) => (
              <tr key={entry.email}>
                <td>
                  <strong>{entry.email}</strong>
                </td>
                <td>
                  <span className="admin-muted">
                    {entry.planTypeLabel || entry.note || '—'}
                  </span>
                </td>
                <td>
                  <span className="admin-muted">
                    {entry.addedAt ? new Date(entry.addedAt).toLocaleDateString() : '—'}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={busy}
                    onClick={() => handleRemove(entry.email)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AdminPage() {
  const [authed, setAuthed] = useState(false)
  const [checking, setChecking] = useState(true)
  const [tab, setTab] = useState('templates')
  const [templates, setTemplates] = useState([])
  const [plans, setPlans] = useState([])
  const [complimentary, setComplimentary] = useState([])
  const [loadError, setLoadError] = useState('')

  const catalog = Object.fromEntries(RESUME_TEMPLATES.map((t) => [t.id, t]))

  async function loadData() {
    setLoadError('')
    const [tplRes, priceRes, accessRes] = await Promise.allSettled([
      fetchAdminTemplates(),
      fetchAdminPricing(),
      fetchComplimentaryEmails(),
    ])

    const errors = [tplRes, priceRes, accessRes]
      .filter((r) => r.status === 'rejected')
      .map((r) => r.reason?.message || 'Request failed')

    if (errors.some((m) => /session expired/i.test(m))) {
      setAuthed(false)
      setTemplates([])
      setPlans([])
      setComplimentary([])
      return
    }

    if (tplRes.status === 'fulfilled') setTemplates(tplRes.value.templates || [])
    if (priceRes.status === 'fulfilled') setPlans(priceRes.value.plans || [])
    if (accessRes.status === 'fulfilled') {
      setComplimentary(accessRes.value.entries || [])
    } else {
      setComplimentary([])
    }

    if (errors.length) setLoadError(errors[0])
  }

  useEffect(() => {
    let cancelled = false
    async function boot() {
      if (!getAdminToken()) {
        if (!cancelled) {
          setAuthed(false)
          setChecking(false)
        }
        return
      }
      try {
        await adminMe()
        await loadData()
        if (!cancelled) setAuthed(true)
      } catch {
        if (!cancelled) setAuthed(false)
      } finally {
        if (!cancelled) setChecking(false)
      }
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleLoginSuccess() {
    setChecking(true)
    try {
      await loadData()
      setAuthed(true)
    } catch (err) {
      setLoadError(err.message)
      setAuthed(true)
    } finally {
      setChecking(false)
    }
  }

  async function handleLogout() {
    await adminLogout()
    setAuthed(false)
    setTemplates([])
    setPlans([])
    setComplimentary([])
  }

  if (checking) {
    return (
      <div className="admin-shell">
        <p className="admin-loading">Loading admin…</p>
      </div>
    )
  }

  if (!authed) {
    return (
      <div className="admin-shell">
        <AdminLogin onSuccess={handleLoginSuccess} />
      </div>
    )
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-topbar__brand">
          <Logo size={28} />
          <div>
            <strong><BrandName /> Admin</strong>
            <span className="admin-muted">You only</span>
          </div>
        </div>
        <div className="admin-topbar__actions">
          <Link to="/" className="btn btn--ghost btn--sm">View site</Link>
          <button type="button" className="btn btn--outline btn--sm" onClick={handleLogout}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="admin-tabs" aria-label="Admin sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`admin-tabs__btn ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="admin-main">
        {loadError && <p className="admin-error">{loadError}</p>}
        {tab === 'templates' && (
          <TemplatesPanel
            templates={templates}
            catalog={catalog}
            onRefresh={async () => {
              const tplRes = await fetchAdminTemplates()
              setTemplates(tplRes.templates || [])
            }}
          />
        )}
        {tab === 'pricing' && (
          <PricingPanel initialPlans={plans} onSaved={setPlans} />
        )}
        {tab === 'access' && (
          <ComplimentaryPanel
            entries={complimentary}
            onChange={setComplimentary}
            onSessionExpired={() => {
              setAuthed(false)
              setTemplates([])
              setPlans([])
              setComplimentary([])
            }}
          />
        )}
      </main>
    </div>
  )
}

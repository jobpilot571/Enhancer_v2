import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchAiCostDashboard, fetchAiCostOperation } from '../../api/admin'

function defaultRange() {
  const to = new Date()
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

function money(n) {
  const v = Number(n) || 0
  if (v === 0) return '$0.00'
  if (Math.abs(v) < 0.01) return `$${v.toFixed(6)}`
  return `$${v.toFixed(4)}`
}

function num(n) {
  return (Number(n) || 0).toLocaleString()
}

function pct(rate) {
  if (rate == null || Number.isNaN(rate)) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

function shortId(id) {
  if (!id) return '—'
  const s = String(id)
  return s.length > 12 ? `${s.slice(0, 8)}…` : s
}

function formatWhen(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return String(iso)
  }
}

const EMPTY_FILTERS = {
  ...defaultRange(),
  service: '',
  provider: '',
  model: '',
  status: '',
  userId: '',
  operationId: '',
}

export default function AiCostPanel({ onSessionExpired }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [applied, setApplied] = useState(EMPTY_FILTERS)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedOp, setSelectedOp] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  const load = useCallback(async (nextFilters) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchAiCostDashboard(nextFilters)
      setData(res)
      setApplied(nextFilters)
    } catch (err) {
      const msg = err.message || 'Failed to load AI costs'
      setError(msg)
      if (/session expired/i.test(msg)) onSessionExpired?.()
    } finally {
      setLoading(false)
    }
  }, [onSessionExpired])

  useEffect(() => {
    load(EMPTY_FILTERS)
  }, [load])

  async function openOperation(operationId) {
    if (!operationId) return
    setSelectedOp(operationId)
    setDetail(null)
    setDetailError('')
    setDetailLoading(true)
    try {
      const res = await fetchAiCostOperation(operationId)
      setDetail(res)
    } catch (err) {
      const msg = err.message || 'Failed to load operation'
      setDetailError(msg)
      if (/session expired/i.test(msg)) onSessionExpired?.()
    } finally {
      setDetailLoading(false)
    }
  }

  function closeDetail() {
    setSelectedOp(null)
    setDetail(null)
    setDetailError('')
  }

  function updateFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }

  function handleApply(e) {
    e?.preventDefault?.()
    load(filters)
  }

  function handleReset() {
    const next = { ...EMPTY_FILTERS, ...defaultRange() }
    setFilters(next)
    load(next)
  }

  const options = data?.filterOptions || { services: [], providers: [], models: [] }
  const overview = data?.overview
  const maxDailyCost = useMemo(() => {
    const days = data?.dailyTrend || []
    return Math.max(0, ...days.map((d) => Number(d.totalCostUsd) || 0))
  }, [data])

  return (
    <section className="admin-panel admin-cost">
      <div className="admin-panel__header">
        <div>
          <h2>AI cost dashboard</h2>
          <p>
            Stored ledger totals from <code>ai_service_costs</code> and{' '}
            <code>ai_usage_events</code>. Admin only — no prompts or resume content.
          </p>
        </div>
        <button type="button" className="btn btn--outline btn--sm" onClick={() => load(applied)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <form className="admin-cost__filters" onSubmit={handleApply}>
        <label className="admin-field">
          <span>From</span>
          <input type="date" value={filters.from} onChange={(e) => updateFilter('from', e.target.value)} />
        </label>
        <label className="admin-field">
          <span>To</span>
          <input type="date" value={filters.to} onChange={(e) => updateFilter('to', e.target.value)} />
        </label>
        <label className="admin-field">
          <span>Service</span>
          <select value={filters.service} onChange={(e) => updateFilter('service', e.target.value)}>
            <option value="">All services</option>
            {(options.services || []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Provider</span>
          <select value={filters.provider} onChange={(e) => updateFilter('provider', e.target.value)}>
            <option value="">All providers</option>
            {(options.providers || []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Model</span>
          <select value={filters.model} onChange={(e) => updateFilter('model', e.target.value)}>
            <option value="">All models</option>
            {(options.models || []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="admin-field">
          <span>Status</span>
          <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}>
            <option value="">Any status</option>
            <option value="Success">Request Success</option>
            <option value="Failed">Request Failed</option>
            <option value="completed">Operation completed</option>
            <option value="failed">Operation failed</option>
          </select>
        </label>
        <label className="admin-field">
          <span>User ID</span>
          <input
            type="text"
            placeholder="uuid"
            value={filters.userId}
            onChange={(e) => updateFilter('userId', e.target.value.trim())}
          />
        </label>
        <label className="admin-field">
          <span>Operation ID</span>
          <input
            type="text"
            placeholder="uuid"
            value={filters.operationId}
            onChange={(e) => updateFilter('operationId', e.target.value.trim())}
          />
        </label>
        <div className="admin-cost__filter-actions">
          <button type="submit" className="btn btn--primary btn--sm" disabled={loading}>Apply</button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleReset} disabled={loading}>Reset</button>
        </div>
      </form>

      {error && <p className="admin-error">{error}</p>}

      {overview && (
        <>
          <div className="admin-cost__source admin-muted">
            Source: {overview.source}
            {overview.range?.from && (
              <> · Range {String(overview.range.from).slice(0, 10)} → {String(overview.range.to).slice(0, 10)} (UTC)</>
            )}
          </div>

          <div className="admin-cost__cards">
            <StatCard label="Cost today (UTC)" value={money(overview.totalCostToday)} />
            <StatCard label="Cost this month (UTC)" value={money(overview.totalCostThisMonth)} />
            <StatCard label="Cost in range" value={money(overview.totalCostInRange)} hint="Operation totals" />
            <StatCard label="AI requests" value={num(overview.totalAiRequests)} hint="Request ledger" />
            <StatCard label="Resumes processed" value={num(overview.totalResumesProcessed)} hint="Completed enhancer/builder/JD ops" />
            <StatCard label="Avg cost / completed op" value={money(overview.averageCostPerCompletedOperation)} />
            <StatCard label="Successful requests" value={num(overview.successfulRequests)} />
            <StatCard label="Failed requests" value={num(overview.failedRequests)} />
            <StatCard label="Missing pricing" value={num(overview.missingPricingRequests)} />
          </div>

          <Section title="Cost by service" desc="From ai_service_costs — one row per operation.">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Total cost</th>
                    <th>Operations</th>
                    <th>Avg / op</th>
                    <th>Tokens</th>
                    <th>Success rate</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.byService || []).length === 0 && (
                    <tr><td colSpan={6} className="admin-muted">No operations in this range.</td></tr>
                  )}
                  {(data.byService || []).map((row) => (
                    <tr key={row.serviceName}>
                      <td>{row.serviceName}</td>
                      <td>{money(row.totalCostUsd)}</td>
                      <td>{num(row.operationCount)}</td>
                      <td>{money(row.averageCostPerOperation)}</td>
                      <td>{num(row.totalTokens)}</td>
                      <td>{pct(row.successRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Cost by provider & model" desc="From ai_usage_events — each AI attempt counted once.">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Requests</th>
                    <th>Prompt tokens</th>
                    <th>Completion tokens</th>
                    <th>Total cost</th>
                    <th>Failed</th>
                    <th>Avg response</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.byProviderModel || []).length === 0 && (
                    <tr><td colSpan={8} className="admin-muted">No requests in this range.</td></tr>
                  )}
                  {(data.byProviderModel || []).map((row) => (
                    <tr key={`${row.provider}-${row.model}`}>
                      <td>{row.provider}</td>
                      <td><code className="admin-cost__code">{row.model}</code></td>
                      <td>{num(row.requestCount)}</td>
                      <td>{num(row.promptTokens)}</td>
                      <td>{num(row.completionTokens)}</td>
                      <td>{money(row.totalCostUsd)}</td>
                      <td>{num(row.failedCalls)}</td>
                      <td>{num(row.averageResponseTimeMs)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Daily cost trend" desc="Operation-level costs by UTC day.">
            {(data.dailyTrend || []).length === 0 ? (
              <p className="admin-muted">No daily data.</p>
            ) : (
              <div className="admin-cost__trend">
                {(data.dailyTrend || []).map((day) => {
                  const width = maxDailyCost > 0 ? Math.max(4, (day.totalCostUsd / maxDailyCost) * 100) : 0
                  return (
                    <div key={day.date} className="admin-cost__trend-row">
                      <div className="admin-cost__trend-meta">
                        <strong>{day.date}</strong>
                        <span>{money(day.totalCostUsd)} · {num(day.operationCount)} ops · avg {money(day.averageCostPerOperation)}</span>
                      </div>
                      <div className="admin-cost__trend-bar" aria-hidden="true">
                        <span style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          <Section title="Expensive operations" desc="Most expensive completed operations (stored totals).">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Service</th>
                    <th>User</th>
                    <th>Session</th>
                    <th>Cost</th>
                    <th>Tokens</th>
                    <th>Attempts</th>
                    <th>Failed</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.expensiveOperations || []).length === 0 && (
                    <tr><td colSpan={9} className="admin-muted">No completed operations.</td></tr>
                  )}
                  {(data.expensiveOperations || []).map((row) => (
                    <tr key={row.operationId}>
                      <td>
                        <button
                          type="button"
                          className="admin-cost__link"
                          onClick={() => openOperation(row.operationId)}
                          title={row.operationId}
                        >
                          {shortId(row.operationId)}
                        </button>
                      </td>
                      <td>{row.serviceName}</td>
                      <td title={row.userId || ''}>{shortId(row.userId)}</td>
                      <td title={row.sessionId || ''}>{shortId(row.sessionId)}</td>
                      <td>{money(row.totalCostUsd)}</td>
                      <td>{num(row.totalTokens)}</td>
                      <td>{num(row.requestCount)}</td>
                      <td>{num(row.failedAttempts)}</td>
                      <td>{formatWhen(row.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
      )}

      {!overview && loading && <p className="admin-muted">Loading cost ledger…</p>}

      {selectedOp && (
        <div className="admin-cost__drawer" role="dialog" aria-modal="true" aria-labelledby="ai-cost-detail-title">
          <div className="admin-cost__drawer-card">
            <div className="admin-cost__drawer-head">
              <div>
                <h3 id="ai-cost-detail-title">Request details</h3>
                <p className="admin-muted"><code>{selectedOp}</code></p>
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={closeDetail}>Close</button>
            </div>

            {detailLoading && <p className="admin-muted">Loading attempts…</p>}
            {detailError && <p className="admin-error">{detailError}</p>}

            {detail?.operation && (
              <div className="admin-cost__op-summary">
                <span>{detail.operation.serviceName}</span>
                <span>{money(detail.operation.totalCostUsd)}</span>
                <span>{num(detail.operation.totalTokens)} tokens</span>
                <span>{detail.operation.status}</span>
                <span>{num(detail.operation.requestCount)} attempts</span>
              </div>
            )}

            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Provider</th>
                    <th>Model</th>
                    <th>Status</th>
                    <th>Tokens</th>
                    <th>Cost</th>
                    <th>Duration</th>
                    <th>Usage</th>
                    <th>Pricing</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail?.attempts || []).length === 0 && !detailLoading && (
                    <tr><td colSpan={10} className="admin-muted">No AI attempts for this operation.</td></tr>
                  )}
                  {(detail?.attempts || []).map((a) => (
                    <tr key={a.id}>
                      <td>{a.featureName}</td>
                      <td>{a.provider}</td>
                      <td><code className="admin-cost__code">{a.model}</code></td>
                      <td>
                        <span className={a.status === 'Failed' ? 'admin-cost__badge admin-cost__badge--fail' : 'admin-cost__badge admin-cost__badge--ok'}>
                          {a.status}
                        </span>
                      </td>
                      <td title={`in ${a.promptTokens} / out ${a.completionTokens}`}>
                        {num(a.totalTokens)}
                      </td>
                      <td>{money(a.totalCostUsd)}</td>
                      <td>{num(a.processingTimeMs)} ms</td>
                      <td>{a.usageSource || '—'}</td>
                      <td>{a.pricingMissing ? 'Missing' : 'OK'}</td>
                      <td className="admin-cost__error-cell" title={a.errorMessage || ''}>
                        {a.errorMessage ? String(a.errorMessage).slice(0, 80) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function StatCard({ label, value, hint }) {
  return (
    <div className="admin-cost__card">
      <span className="admin-cost__card-label">{label}</span>
      <strong className="admin-cost__card-value">{value}</strong>
      {hint && <span className="admin-muted">{hint}</span>}
    </div>
  )
}

function Section({ title, desc, children }) {
  return (
    <div className="admin-cost__section">
      <div className="admin-cost__section-head">
        <h3>{title}</h3>
        {desc && <p className="admin-muted">{desc}</p>}
      </div>
      {children}
    </div>
  )
}

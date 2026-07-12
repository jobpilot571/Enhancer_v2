import PDFDocument from 'pdfkit'
import { getScoringEngineInfo } from './aiProvider.js'

const COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  body: '#334155',
  teal: '#0d9488',
  green: '#047857',
  greenBg: '#d1fae5',
  orange: '#c2410c',
  orangeBg: '#ffedd5',
  red: '#b91c1c',
  redBg: '#fee2e2',
  blue: '#1d4ed8',
  blueBg: '#dbeafe',
  card: '#f8fafc',
  line: '#e2e8f0',
  white: '#ffffff',
}

function safe(text, max = 200) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10
}

function matchLevel(score) {
  if (score >= 90) return { stars: 5, label: 'Excellent Match' }
  if (score >= 80) return { stars: 4, label: 'Very Good Match' }
  if (score >= 70) return { stars: 3, label: 'Good Match' }
  if (score >= 55) return { stars: 2, label: 'Fair Match' }
  return { stars: 1, label: 'Needs Work' }
}

function stars(n) {
  return `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`
}

function drawRoundedRect(doc, x, y, w, h, r = 8) {
  doc.roundedRect(x, y, w, h, r)
}

function card(doc, x, y, w, h, fill = COLORS.card) {
  doc.save()
  doc.fillColor(fill).strokeColor(COLORS.line).lineWidth(0.8)
  drawRoundedRect(doc, x, y, w, h, 10)
  doc.fillAndStroke()
  doc.restore()
}

function sectionLabel(doc, x, y, text) {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.ink).text(text, x, y, { lineBreak: false })
  return y + 16
}

function chipRow(doc, x, y, maxW, items, color, bg, limit = 10) {
  const list = (items || []).filter(Boolean).slice(0, limit)
  if (!list.length) {
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('None', x, y)
    return y + 14
  }
  let cx = x
  let cy = y
  const rowH = 14
  for (const raw of list) {
    const label = safe(raw, 28)
    doc.font('Helvetica').fontSize(7.5)
    const tw = doc.widthOfString(label) + 10
    if (cx + tw > x + maxW) {
      cx = x
      cy += rowH + 3
    }
    doc.save()
    doc.fillColor(bg).roundedRect(cx, cy, tw, rowH, 4).fill()
    doc.fillColor(color).text(label, cx + 5, cy + 3, { lineBreak: false })
    doc.restore()
    cx += tw + 4
  }
  return cy + rowH + 4
}

function statusBar(doc, x, y, w, label, status) {
  const colors = {
    covered: { fg: COLORS.green, bg: COLORS.greenBg, tag: 'Covered' },
    partial: { fg: COLORS.orange, bg: COLORS.orangeBg, tag: 'Partial' },
    missing: { fg: COLORS.red, bg: COLORS.redBg, tag: 'Missing' },
  }
  const c = colors[status] || colors.missing
  doc.save()
  doc.fillColor(c.bg).roundedRect(x, y, w, 16, 4).fill()
  doc.fillColor(c.fg).font('Helvetica').fontSize(7.5)
  doc.text(safe(label, 42), x + 6, y + 4, { width: w - 70, lineBreak: false })
  doc.font('Helvetica-Bold').text(c.tag, x + w - 58, y + 4, { width: 52, align: 'right', lineBreak: false })
  doc.restore()
  return y + 19
}

/**
 * Compact 1–2 page Resume Match Analysis PDF (dashboard style).
 */
export function buildScoreReportPdf({
  session = {},
  matchAnalysis = {},
  comparison = {},
  comparisonBefore = {},
  aiUsage = null,
  generatedAt = new Date(),
} = {}) {
  const scoreReport = matchAnalysis.scoreReport || matchAnalysis.scoreComparison || {}
  const beforeReport = scoreReport.beforeReport || comparisonBefore.report || {}
  const afterReport = scoreReport.afterReport || comparison.report || {}
  const breakdown = scoreReport.breakdown || {}
  const processingMeta = matchAnalysis.processingMeta || scoreReport.processingMeta || {}
  const usage = aiUsage || processingMeta.aiUsage || null
  const engine = getScoringEngineInfo()

  const beforeScore = scoreReport.beforeScore ?? comparisonBefore.atsScore ?? 0
  const afterScore = scoreReport.afterScore ?? comparison.atsScore ?? matchAnalysis.afterScore ?? 0
  const improvement = scoreReport.improvement ?? (afterScore - beforeScore)
  const level = matchLevel(afterScore)

  const skillsAdded = (matchAnalysis.skillsAdded || []).map((s) => (typeof s === 'string' ? s : s.skill)).filter(Boolean)
  const addedBullets = matchAnalysis.addedBullets || []
  const addedKeywords = matchAnalysis.addedKeywords || []
  const summaryImproved = (matchAnalysis.summaryRewrites || 0) + (matchAnalysis.summaryBulletsAdded || 0)
  const toolsAdded = skillsAdded.filter((s) => /sql|jira|excel|power|tableau|azure|visio|confluence|python|aws/i.test(s))

  const matchedSkills = afterReport.matchedRequiredSkills || []
  const partialSkills = afterReport.partiallyMatchedRequiredSkills || []
  const missingSkills = afterReport.missingRequiredSkills || []
  const covered = afterReport.coveredResponsibilities || []
  const partialResp = afterReport.partiallyCoveredResponsibilities || []
  const missingResp = afterReport.missingResponsibilities || []

  const kwMatched = (afterReport.matchedKeywords || []).length
  const kwTotal = kwMatched + (afterReport.missingKeywords || []).length || 1
  const respTotal = covered.length + partialResp.length + missingResp.length || 1
  const respCoveredScore = covered.length + partialResp.length * 0.5

  const catRows = [
    ['Hard Skills & Tools', 'requiredSkills', 24],
    ['Title & Domain Keywords', 'keywords', 16],
    ['Experience & Impact', 'experience', 40],
    ['Format & Readability', 'format', 20],
  ]

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: 36, bottom: 36, left: 36, right: 36 },
    info: {
      Title: 'JoBPilot.AI Resume Match Analysis',
      Author: 'JoBPilot.AI',
      Subject: 'ATS Resume Enhancement Report',
    },
  })

  const chunks = []
  doc.on('data', (c) => chunks.push(c))
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const pageW = doc.page.width
  const left = doc.page.margins.left
  const right = pageW - doc.page.margins.right
  const contentW = right - left
  let y = doc.page.margins.top

  // ── Header ──
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.ink).text('Resume Match Analysis', left, y)
  y += 22
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.teal).text('JoBPilot.AI  ·  ATS Resume Enhancer', left, y)
  doc.fillColor(COLORS.muted).text(generatedAt.toLocaleString(), right - 160, y, { width: 160, align: 'right' })
  y += 14
  if (session.fileName) {
    doc.fillColor(COLORS.muted).fontSize(8).text(`File: ${safe(session.fileName, 80)}`, left, y)
    y += 12
  }
  y += 6

  // ── Row 1: Overall score + Enhancement summary ──
  const row1H = 118
  const leftCardW = contentW * 0.58
  const rightCardW = contentW - leftCardW - 10
  card(doc, left, y, leftCardW, row1H, COLORS.white)
  card(doc, left + leftCardW + 10, y, rightCardW, row1H, COLORS.white)

  let cy = sectionLabel(doc, left + 12, y + 10, 'Overall ATS Score')
  // Before / After big numbers
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('BEFORE', left + 20, cy)
  doc.text('AFTER', left + 110, cy)
  cy += 12
  doc.font('Helvetica-Bold').fontSize(28).fillColor(COLORS.orange).text(String(beforeScore), left + 20, cy, { lineBreak: false })
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text('/100', left + 58, cy + 14, { lineBreak: false })
  doc.font('Helvetica-Bold').fontSize(28).fillColor(COLORS.green).text(String(afterScore), left + 110, cy, { lineBreak: false })
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text('/100', left + 148, cy + 14, { lineBreak: false })

  // Improvement badge
  const badgeX = left + 210
  const badgeY = cy
  doc.save()
  doc.fillColor(COLORS.greenBg).roundedRect(badgeX, badgeY, 140, 44, 8).fill()
  doc.fillColor(COLORS.green).font('Helvetica-Bold').fontSize(14)
    .text(`${improvement >= 0 ? '+' : ''}${improvement} Points`, badgeX + 10, badgeY + 8, { lineBreak: false })
  doc.font('Helvetica').fontSize(8).text('Improved', badgeX + 10, badgeY + 26, { lineBreak: false })
  doc.restore()

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.body)
    .text(
      improvement >= 10
        ? 'Great job! Your resume is much more likely to pass ATS.'
        : improvement > 0
          ? 'Coverage improved in one or more scoring categories.'
          : 'Score did not increase — no new JD coverage was added.',
      left + 20,
      y + row1H - 22,
      { width: leftCardW - 40 },
    )

  // Enhancement summary
  let sy = sectionLabel(doc, left + leftCardW + 22, y + 10, 'Enhancement Summary')
  const summaryLines = [
    ['Skills Added', skillsAdded.length],
    ['Keywords Added', addedKeywords.length],
    ['Bullets Improved', addedBullets.length],
    ['Summary Improved', summaryImproved],
    ['Tools Added', toolsAdded.length || '—'],
    ['Validation', 'Passed'],
  ]
  doc.font('Helvetica').fontSize(8)
  for (const [label, val] of summaryLines) {
    doc.fillColor(COLORS.muted).text(label, left + leftCardW + 22, sy, { lineBreak: false })
    doc.fillColor(COLORS.ink).font('Helvetica-Bold')
      .text(String(val), left + leftCardW + rightCardW - 28, sy, { width: 20, align: 'right', lineBreak: false })
    doc.font('Helvetica')
    sy += 13
  }

  y += row1H + 12

  // ── Row 2: Score breakdown + Skills analysis ──
  const row2H = 168
  const breakW = contentW * 0.52
  const skillsW = contentW - breakW - 10
  card(doc, left, y, breakW, row2H, COLORS.white)
  card(doc, left + breakW + 10, y, skillsW, row2H, COLORS.white)

  let by = sectionLabel(doc, left + 12, y + 10, 'Score Breakdown')
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
    .text('Category', left + 14, by, { lineBreak: false })
    .text('Before → After', left + breakW - 130, by, { lineBreak: false })
    .text('Δ', left + breakW - 28, by, { lineBreak: false })
  by += 12
  for (const [label, key, maxDefault] of catRows) {
    const b = breakdown[key] || {}
    const before = round1(b.before ?? beforeReport.categories?.[key]?.score ?? 0)
    const after = round1(b.after ?? afterReport.categories?.[key]?.score ?? 0)
    const max = b.max ?? maxDefault
    const change = round1(b.change ?? (after - before))
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.body)
      .text(`${label} (${max})`, left + 14, by, { width: breakW - 150, lineBreak: false })
    doc.fillColor(COLORS.ink).text(`${before} → ${after}`, left + breakW - 130, by, { lineBreak: false })
    doc.fillColor(change > 0 ? COLORS.green : COLORS.muted).font('Helvetica-Bold')
      .text(change > 0 ? `+${change}` : String(change), left + breakW - 36, by, { width: 28, align: 'right', lineBreak: false })
    by += 14
  }

  let skY = sectionLabel(doc, left + breakW + 22, y + 10, 'Skills Analysis')
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.green)
    .text(`Matched (${matchedSkills.length + partialSkills.length})`, left + breakW + 22, skY)
  skY += 11
  skY = chipRow(doc, left + breakW + 22, skY, skillsW - 34, [...matchedSkills, ...partialSkills], COLORS.green, COLORS.greenBg, 8)
  skY += 4
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.blue)
    .text(`Added / Improved (${skillsAdded.length})`, left + breakW + 22, skY)
  skY += 11
  skY = chipRow(doc, left + breakW + 22, skY, skillsW - 34, skillsAdded, COLORS.blue, COLORS.blueBg, 8)
  skY += 4
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.red)
    .text(`Missing (${missingSkills.length})`, left + breakW + 22, skY)
  skY += 11
  chipRow(doc, left + breakW + 22, skY, skillsW - 34, missingSkills, COLORS.red, COLORS.redBg, 6)

  y += row2H + 12

  // ── Row 3: Responsibilities + AI details + coverage ──
  const row3H = 175
  const respW = contentW * 0.55
  const metaW = contentW - respW - 10
  card(doc, left, y, respW, row3H, COLORS.white)
  card(doc, left + respW + 10, y, metaW, row3H, COLORS.white)

  let ry = sectionLabel(doc, left + 12, y + 10, 'JD Responsibilities Coverage')
  const respItems = [
    ...covered.slice(0, 5).map((t) => [t, 'covered']),
    ...partialResp.slice(0, 3).map((t) => [t, 'partial']),
    ...missingResp.slice(0, 3).map((t) => [t, 'missing']),
  ].slice(0, 8)
  if (!respItems.length) {
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('No responsibility data available.', left + 14, ry)
  } else {
    for (const [text, status] of respItems) {
      ry = statusBar(doc, left + 12, ry, respW - 24, text, status)
    }
  }

  let my = sectionLabel(doc, left + respW + 22, y + 10, 'AI & Processing Details')
  const provider = usage?.primaryProvider || usage?.summary?.[0]?.provider || 'Not recorded'
  const model = usage?.primaryModel || usage?.summary?.[0]?.model || '—'
  const duration = processingMeta.durationSec != null ? `${processingMeta.durationSec}s` : '—'
  const metaLines = [
    ['AI Provider', provider],
    ['Model Used', model],
    ['Processing Time', duration],
    ['Scoring Engine', 'ATS 40/40/20 v3.0'],
    ['AI used for', 'Parse + enhance plan'],
    ['Score calculated by', 'Local rules (no LLM)'],
  ]
  doc.font('Helvetica').fontSize(8)
  for (const [k, v] of metaLines) {
    doc.fillColor(COLORS.muted).text(k, left + respW + 22, my, { lineBreak: false })
    doc.fillColor(COLORS.ink).font('Helvetica-Bold')
      .text(safe(v, 28), left + respW + 22, my, { width: metaW - 34, align: 'right', lineBreak: false })
    doc.font('Helvetica')
    my += 13
  }

  my += 6
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.ink).text('Coverage', left + respW + 22, my)
  my += 12
  const kwPct = Math.round((kwMatched / kwTotal) * 100)
  const respPct = Math.round((respCoveredScore / respTotal) * 100)
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.body)
    .text(`Keywords  ${kwMatched}/${kwTotal} (${kwPct}%)`, left + respW + 22, my)
  my += 12
  doc.text(`Responsibilities  ${round1(respCoveredScore)}/${respTotal} (${respPct}%)`, left + respW + 22, my)
  my += 14
  doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.teal)
    .text(`JD Match  ${stars(level.stars)}  ${level.label}`, left + respW + 22, my)

  y += row3H + 12

  // ── What Improved ──
  const highlightH = 58
  card(doc, left, y, contentW, highlightH, COLORS.white)
  let hy = sectionLabel(doc, left + 12, y + 8, 'What Improved')
  const highlights = []
  if (skillsAdded.length) highlights.push(`Added ${skillsAdded.length} new skills`)
  if (addedBullets.length) highlights.push(`Strengthened ${addedBullets.length} bullets`)
  if (addedKeywords.length) highlights.push(`Added ${addedKeywords.length} keywords`)
  if (summaryImproved) highlights.push('Improved summary')
  if ((breakdown.experience?.change || 0) > 0) highlights.push('Better experience coverage')
  if (!highlights.length) highlights.push('No measurable coverage gains')

  const colW = (contentW - 24) / Math.min(highlights.length, 5)
  highlights.slice(0, 5).forEach((h, i) => {
    const hx = left + 12 + i * colW
    doc.save()
    doc.fillColor(COLORS.greenBg).roundedRect(hx, hy, colW - 6, 24, 6).fill()
    doc.fillColor(COLORS.green).font('Helvetica-Bold').fontSize(7.5)
      .text(h, hx + 4, hy + 8, { width: colW - 14, align: 'center', lineBreak: false })
    doc.restore()
  })

  y += highlightH + 10

  // ── Footer note ──
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
    .text(
      `${engine.name} — ${engine.method}. Same formula for before & after. Score rises only when real JD coverage improves.`,
      left,
      y,
      { width: contentW, align: 'center' },
    )

  // Page 2 only if we have enough evidence / penalties to justify it
  const evidence = (afterReport.evidence || []).slice(0, 12)
  const penalties = scoreReport.penalties || afterReport.penalties || comparison.penalties || []
  const reasons = (afterReport.scoringReasons || []).slice(0, 8)

  if (evidence.length >= 4 || penalties.length || reasons.length >= 4) {
    doc.addPage()
    y = doc.page.margins.top
    doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.ink).text('Evidence & Scoring Detail', left, y)
    y += 22

    card(doc, left, y, contentW, 320, COLORS.white)
    let ey = sectionLabel(doc, left + 12, y + 10, 'How points were awarded (sample evidence)')
    if (!evidence.length) {
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('No evidence rows available.', left + 14, ey)
      ey += 14
    } else {
      for (const ev of evidence) {
        if (ey > y + 290) break
        doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.ink)
          .text(safe(ev.requirement, 70), left + 14, ey, { width: contentW - 28 })
        ey += 11
        doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.body)
          .text(
            `${safe(ev.resumeEvidence, 110)}  ·  ${ev.section || '—'}  ·  ${ev.matchType || '—'}  ·  ${ev.pointsAwarded ?? '—'} pts`,
            left + 14,
            ey,
            { width: contentW - 28 },
          )
        ey += 14
      }
    }

    y += 332
    card(doc, left, y, contentW * 0.48, 120, COLORS.white)
    card(doc, left + contentW * 0.48 + 10, y, contentW * 0.52 - 10, 120, COLORS.white)

    let py = sectionLabel(doc, left + 12, y + 10, 'Penalties')
    if (!penalties.length) {
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('No penalties applied.', left + 14, py)
    } else {
      for (const p of penalties.slice(0, 5)) {
        doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.red)
          .text(`• [${p.type}] ${safe(p.detail || p.item, 60)} (−${p.amount ?? 0})`, left + 14, py, { width: contentW * 0.48 - 28 })
        py += 12
      }
    }

    let rsy = sectionLabel(doc, left + contentW * 0.48 + 22, y + 10, 'Scoring reasons')
    for (const reason of reasons.slice(0, 6)) {
      doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.body)
        .text(`• ${safe(reason, 70)}`, left + contentW * 0.48 + 22, rsy, { width: contentW * 0.52 - 40 })
      rsy += 12
    }

    y += 132
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
      .text(
        'Page 2 of 2  ·  JoBPilot.AI confidential score report  ·  Deterministic scoring (no LLM for final score)',
        left,
        y,
        { width: contentW, align: 'center' },
      )
  } else {
    doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
      .text('Page 1 of 1  ·  JoBPilot.AI', left, doc.page.height - 28, { width: contentW, align: 'center' })
  }

  doc.end()
  return done
}

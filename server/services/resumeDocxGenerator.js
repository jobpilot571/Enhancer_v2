import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  TabStopType,
  TabStopPosition,
  convertInchesToTwip,
  ShadingType,
  LevelFormat,
} from 'docx'
import { getTemplateStyle } from './resumeTemplates.js'

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function fontOf(style) {
  return style?.fontFamily || 'Calibri'
}

function bodySizeOf(style) {
  const n = Number(style?.bodySize)
  return Number.isFinite(n) && n >= 16 ? n : 24 // default 12pt
}

function formatDates(start, end) {
  const s = clean(start)
  const e = clean(end) || 'Present'
  if (!s && !e) return ''
  if (!s) return e
  return `${s} - ${e}`
}

function sanitizeLocPart(value) {
  const v = clean(value)
  if (!v) return ''
  if (/^(n\/?a|na|none|null|undefined|remote|tbd|unknown)$/i.test(v)) return ''
  return v
}

function formatCityState(city, state) {
  return [sanitizeLocPart(city), sanitizeLocPart(state)].filter(Boolean).join(', ')
}

function collectKeywords(resume) {
  const fromCats = (resume.skillCategories || []).flatMap((c) => c.skills || [])
  const raw = [
    ...(resume.keywords || []),
    ...(resume.skills || []),
    ...(resume.technicalSkills || []),
    ...fromCats,
  ]
  const seen = new Set()
  const out = []
  for (const item of raw) {
    const k = clean(item)
    if (!k || k.length < 2) continue
    const key = k.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(k)
  }
  // Longer phrases first so "Spark SQL" wins over "SQL"
  return out.sort((a, b) => b.length - a.length)
}

function buildHighlightedRuns(text, keywords, { size = 24, color = '1F2937', boldAll = false, font = 'Calibri' } = {}) {
  const full = String(text || '')
  if (!full) return []
  if (boldAll || !keywords?.length) {
    return [new TextRun({ text: full, size, font, color, bold: boldAll })]
  }

  const lower = full.toLowerCase()
  const parts = []
  let cursor = 0
  while (cursor < full.length) {
    let hitAt = -1
    let hitLen = 0
    for (const phrase of keywords) {
      const p = String(phrase || '').trim()
      if (p.length < 2) continue
      const idx = lower.indexOf(p.toLowerCase(), cursor)
      if (idx === -1) continue
      if (hitAt === -1 || idx < hitAt || (idx === hitAt && p.length > hitLen)) {
        // Prefer word-ish boundaries for short tokens
        if (p.length <= 3) {
          const before = idx === 0 || /[^a-z0-9]/i.test(full[idx - 1] || '')
          const after = idx + p.length >= full.length || /[^a-z0-9]/i.test(full[idx + p.length] || '')
          if (!before || !after) continue
        }
        hitAt = idx
        hitLen = p.length
      }
    }
    if (hitAt === -1) {
      parts.push({ text: full.slice(cursor), bold: false })
      break
    }
    if (hitAt > cursor) parts.push({ text: full.slice(cursor, hitAt), bold: false })
    parts.push({ text: full.slice(hitAt, hitAt + hitLen), bold: true })
    cursor = hitAt + hitLen
  }

  return parts
    .filter((p) => p.text)
    .map((p) => new TextRun({
      text: p.text,
      size,
      font,
      color,
      bold: p.bold,
    }))
}

function sectionHeading(text, accent, compact, style = {}) {
  const isClassic = style.headingStyle === 'underline-colon'
  const label = isClassic ? `${text.toUpperCase()}:` : text.toUpperCase()
  const font = fontOf(style)
  const size = Math.max(22, bodySizeOf(style) + 2)

  return new Paragraph({
    spacing: { before: compact ? 160 : 240, after: compact ? 60 : 80 },
    border: isClassic
      ? undefined
      : {
          bottom: { style: BorderStyle.SINGLE, size: 12, color: accent, space: 4 },
        },
    children: [
      new TextRun({
        text: label,
        bold: true,
        size,
        font,
        color: accent,
        underline: isClassic ? {} : undefined,
      }),
    ],
  })
}

function bodyPara(text, opts = {}, style = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 60 },
    children: [
      new TextRun({
        text: clean(text),
        size: opts.run?.size || bodySizeOf(style),
        font: fontOf(style),
        color: '1F2937',
        ...opts.run,
      }),
    ],
  })
}

/** Real Word list bullets (numPr) — Enter/new bullet works correctly in Word. */
function bulletPara(text, compact, keywords = [], style = {}) {
  const body = clean(text).replace(/^[•\-\*]\s*/, '')
  const size = bodySizeOf(style)
  const font = fontOf(style)
  const useHighlight = style.keywordHighlight === true
  const runs = buildHighlightedRuns(body, useHighlight ? keywords : [], {
    size,
    font,
    color: '1F2937',
  })
  return new Paragraph({
    numbering: { reference: 'resume-bullets', level: 0 },
    spacing: { after: compact ? 24 : 40 },
    children: runs,
  })
}

function contactLine(resume, style = {}) {
  if (style.contactStyle === 'phone-email') {
    return [clean(resume.phone), clean(resume.email)].filter(Boolean).join('  |  ')
  }
  const loc = sanitizeLocPart(resume.location)
    || formatCityState(resume.city, resume.state)
  const bits = [
    loc,
    clean(resume.phone),
    clean(resume.email),
    clean(resume.linkedin),
  ].filter(Boolean)
  return bits.join('  |  ')
}

function rightTabStop(style) {
  return style.rightTab || TabStopPosition.RIGHT
}

function buildHeader(resume, style) {
  const accent = style.accent || '1E40AF'
  const nameColor = style.nameColor || accent
  const children = []
  const name = clean(resume.name) || 'Resume'
  const title = clean(resume.title || resume.role)
  const contact = contactLine(resume, style)

  if (style.headerStyle === 'banner') {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        shading: { type: ShadingType.CLEAR, fill: accent },
        children: [
          new TextRun({
            text: name.toUpperCase(),
            bold: true,
            size: 36,
            font: fontOf(style),
            color: 'FFFFFF',
          }),
        ],
      }),
    )
    if (style.showTitle && title) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 40 },
          shading: { type: ShadingType.CLEAR, fill: accent },
          children: [
            new TextRun({
              text: title,
              size: 20,
              font: fontOf(style),
              color: 'E5E7EB',
            }),
          ],
        }),
      )
    }
    if (contact) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
          shading: { type: ShadingType.CLEAR, fill: accent },
          children: [
            new TextRun({
              text: contact,
              size: 16,
              font: fontOf(style),
              color: 'F3F4F6',
            }),
          ],
        }),
      )
    }
    return children
  }

  // Centered header
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: name.toUpperCase(),
          bold: true,
          size: 36,
          font: fontOf(style),
          color: nameColor,
        }),
      ],
    }),
  )

  if (style.showTitle && title && !style.titleBelowContact) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: title,
            bold: true,
            size: 22,
            font: fontOf(style),
            color: '000000',
          }),
        ],
      }),
    )
  }

  if (contact) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: style.titleBelowContact ? 40 : (style.headingStyle === 'underline-colon' ? 80 : 160) },
        children: [
          new TextRun({
            text: contact,
            size: 18,
            font: fontOf(style),
            color: '000000',
          }),
        ],
      }),
    )
  }

  if (style.showTitle && title && style.titleBelowContact) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 160 },
        children: [
          new TextRun({
            text: title,
            italics: true,
            size: 20,
            font: fontOf(style),
            color: '374151',
          }),
        ],
      }),
    )
  }

  // Full-width rule under header (JD Classic / similar)
  if (style.headingStyle === 'underline-colon') {
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 18, color: '000000', space: 1 },
        },
        children: [],
      }),
    )
  }

  return children
}

function buildExperienceEntry(job, style, compact, keywords = []) {
  const accent = style.forceBlack ? '000000' : (style.accent || '1E40AF')
  const ink = style.forceBlack ? '000000' : '111827'
  const muted = style.forceBlack ? '000000' : '4B5563'
  const companyColor = style.forceBlack ? '000000' : accent
  const company = clean(job.company)
  const title = clean(job.title)
  const dates = clean(job.dates) || formatDates(job.startDate, job.endDate)
  const loc = sanitizeLocPart(job.location) || formatCityState(job.city, job.state)
  const paras = []
  const layout = style.experienceLayout || 'title-dates'

  if (layout === 'company-role-split') {
    // Company ................ Dates
    // Role .................... Location
    paras.push(
      new Paragraph({
        spacing: { before: compact ? 80 : 120, after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
        children: [
          new TextRun({ text: company, bold: true, size: 20, font: fontOf(style), color: ink }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: dates, bold: true, size: 18, font: fontOf(style), color: ink }),
        ],
      }),
    )
    if (title || loc) {
      paras.push(
        new Paragraph({
          spacing: { after: 40 },
          tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
          children: [
            new TextRun({ text: title, bold: true, italics: true, size: 20, font: fontOf(style), color: ink }),
            new TextRun({ text: '\t' }),
            new TextRun({ text: loc, size: 18, font: fontOf(style), color: muted }),
          ],
        }),
      )
    }
  } else if (layout === 'company-first') {
    paras.push(
      new Paragraph({
        spacing: { before: compact ? 80 : 120, after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
        children: [
          new TextRun({ text: company, bold: true, size: 20, font: fontOf(style), color: ink }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: dates, bold: true, size: 18, font: fontOf(style), color: ink }),
        ],
      }),
    )
    if (title || loc) {
      paras.push(
        new Paragraph({
          spacing: { after: style.showResponsibilitiesLabel ? 20 : 40 },
          tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
          children: [
            new TextRun({
              text: title,
              italics: !style.showResponsibilitiesLabel,
              bold: true,
              size: 20,
              font: fontOf(style),
              color: '000000',
            }),
            new TextRun({ text: '\t' }),
            new TextRun({ text: loc, size: 18, font: fontOf(style), color: muted }),
          ],
        }),
      )
    }
    if (style.showResponsibilitiesLabel) {
      paras.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({
              text: 'Responsibilities:',
              bold: true,
              size: 20,
              font: fontOf(style),
              color: '000000',
            }),
          ],
        }),
      )
    }
  } else if (layout === 'title-company') {
    paras.push(
      new Paragraph({
        spacing: { before: compact ? 80 : 120, after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
        children: [
          new TextRun({ text: company || title, bold: true, size: 20, font: fontOf(style), color: ink }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: dates, bold: true, size: 18, font: fontOf(style), color: ink }),
        ],
      }),
    )
    if (title || loc) {
      paras.push(
        new Paragraph({
          spacing: { after: 40 },
          tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
          children: [
            new TextRun({
              text: company ? title : '',
              bold: true,
              italics: true,
              size: 20,
              font: fontOf(style),
              color: ink,
            }),
            new TextRun({ text: '\t' }),
            new TextRun({ text: loc, size: 18, font: fontOf(style), color: muted }),
          ],
        }),
      )
    }
  } else if (layout === 'title-company-split') {
    paras.push(
      new Paragraph({
        spacing: { before: compact ? 80 : 120, after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
        children: [
          new TextRun({ text: company || title, bold: true, size: 20, font: fontOf(style), color: ink }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: dates, bold: true, size: 18, font: fontOf(style), color: ink }),
        ],
      }),
    )
    paras.push(
      new Paragraph({
        spacing: { after: 40 },
        tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
        children: [
          new TextRun({ text: company ? title : '', bold: true, size: 20, font: fontOf(style), color: companyColor }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: loc, size: 18, font: fontOf(style), color: muted }),
        ],
      }),
    )
  } else {
    // title-dates → still prefer company left / dates right for clarity
    paras.push(
      new Paragraph({
        spacing: { before: compact ? 80 : 120, after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
        children: [
          new TextRun({ text: company || title, bold: true, size: 20, font: fontOf(style), color: ink }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: dates, bold: true, size: 18, font: fontOf(style), color: ink }),
        ],
      }),
    )
    if (title || loc) {
      paras.push(
        new Paragraph({
          spacing: { after: 40 },
          tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
          children: [
            new TextRun({
              text: company ? title : '',
              bold: true,
              italics: true,
              size: 20,
              font: fontOf(style),
              color: muted,
            }),
            new TextRun({ text: '\t' }),
            new TextRun({ text: loc, size: 18, font: fontOf(style), color: muted }),
          ],
        }),
      )
    }
  }

  for (const b of (job.bullets || []).map(clean).filter(Boolean)) {
    paras.push(bulletPara(b, compact, keywords, style))
  }
  return paras
}

/**
 * Build a professional DOCX from structured resume JSON + template id.
 * @param {object} [options]
 * @param {boolean} [options.forceBlack] — JD Builder: all text/accents black only
 * @param {string} [options.fontFamily] — e.g. Calibri, Arial, Times New Roman, Georgia
 * @param {number} [options.fontSizePt] — body font size in points (default 12)
 * @param {boolean} [options.keywordHighlight] — bold JD/skill keywords in bullets (default false)
 */
export async function generateResumeDocx(resume, templateId = 'classic-blue', options = {}) {
  let style = { ...getTemplateStyle(templateId) }
  if (options.forceBlack) {
    style = {
      ...style,
      accent: '000000',
      nameColor: '000000',
      forceBlack: true,
      experienceLayout: 'company-role-split',
      // Avoid colored banner headers
      headerStyle: style.headerStyle === 'banner' ? 'centered' : style.headerStyle,
    }
  }
  const fontSizePt = Number(options.fontSizePt)
  style.fontFamily = String(options.fontFamily || style.fontFamily || 'Calibri').trim() || 'Calibri'
  style.bodySize = Number.isFinite(fontSizePt) && fontSizePt >= 9 && fontSizePt <= 14
    ? Math.round(fontSizePt * 2)
    : 24
  style.keywordHighlight = options.keywordHighlight === true

  const accent = style.accent || '1E40AF'
  const compact = !!style.compact
  const margin = style.pageBorder ? 0.5 : (compact ? 0.4 : 0.45)
  // US Letter 8.5" → content width for right-aligned dates/locations
  style.rightTab = convertInchesToTwip(8.5 - margin * 2)
  const keywords = collectKeywords(resume)
  const children = []

  children.push(...buildHeader(resume, style))

  const summaryText = clean(resume.summary)
  const summaryBullets = Array.isArray(resume.summaryBullets)
    ? resume.summaryBullets.map(clean).filter(Boolean)
    : []

  if (summaryText || summaryBullets.length) {
    children.push(sectionHeading('Professional Summary', accent, compact, style))
    if (summaryText && !summaryBullets.length) {
      children.push(bodyPara(summaryText, { after: 80 }, style))
    }
    for (const b of summaryBullets) children.push(bulletPara(b, compact, keywords, style))
  }

  // Categorized skills if provided, else flat list
  const skillCategories = Array.isArray(resume.skillCategories) ? resume.skillCategories : []
  const flatSkills = [
    ...new Set([
      ...(Array.isArray(resume.skills) ? resume.skills : []),
      ...(Array.isArray(resume.technicalSkills) ? resume.technicalSkills : []),
    ].map(clean).filter(Boolean)),
  ]

  if (skillCategories.length || flatSkills.length) {
    children.push(sectionHeading('Technical Skills', accent, compact, style))
    if (skillCategories.length) {
      for (const cat of skillCategories) {
        const label = clean(cat.category)
        const items = (cat.skills || []).map(clean).filter(Boolean)
        if (!label || !items.length) continue
        if (style.skillsAsBullets) {
          children.push(
            new Paragraph({
              numbering: { reference: 'resume-bullets', level: 0 },
              spacing: { after: compact ? 24 : 40 },
              children: [
                new TextRun({
                  text: `${label}: `,
                  bold: true,
                  size: bodySizeOf(style),
                  font: fontOf(style),
                  color: '000000',
                }),
                new TextRun({
                  text: items.join(', '),
                  size: bodySizeOf(style),
                  font: fontOf(style),
                  color: '000000',
                }),
              ],
            }),
          )
        } else {
          children.push(
            new Paragraph({
              spacing: { after: 40 },
              children: [
                new TextRun({
                  text: `${label}: `,
                  bold: true,
                  size: bodySizeOf(style),
                  font: fontOf(style),
                  color: accent,
                }),
                new TextRun({
                  text: items.join(', '),
                  size: bodySizeOf(style),
                  font: fontOf(style),
                  color: style.forceBlack ? '000000' : '1F2937',
                }),
              ],
            }),
          )
        }
      }
    } else {
      children.push(bodyPara(flatSkills.join(' · '), { after: 80 }, style))
    }
  }

  const experience = Array.isArray(resume.experience) ? resume.experience : []
  if (experience.length) {
    children.push(sectionHeading('Professional Experience', accent, compact, style))
    for (const job of experience) {
      children.push(...buildExperienceEntry(job, style, compact, keywords))
    }
  }

  const education = Array.isArray(resume.education) ? resume.education : []
  if (education.length) {
    children.push(sectionHeading('Education', accent, compact, style))
    for (const edu of education) {
      if (typeof edu === 'string') {
        children.push(bodyPara(edu, { after: 60 }, style))
        continue
      }
      const school = clean(edu.school || edu.university || edu.college)
      const degree = clean(edu.degree)
      const course = clean(edu.course || edu.field || edu.major)
      const dates = clean(edu.dates) || formatDates(edu.startDate, edu.endDate)
      const eduLoc = sanitizeLocPart(edu.location)
      const degreeLine = [degree, course].filter(Boolean).join(', ')

      children.push(
        new Paragraph({
          spacing: { before: 80, after: 20 },
          tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
          children: [
            new TextRun({
              text: school || degreeLine,
              bold: true,
              size: 20,
              font: fontOf(style),
              color: '111827',
            }),
            new TextRun({ text: '\t' }),
            new TextRun({ text: dates, size: 18, font: fontOf(style), color: '4B5563' }),
          ],
        }),
      )
      if (school && degreeLine) {
        children.push(
          new Paragraph({
            spacing: { after: eduLoc ? 10 : 60 },
            tabStops: [{ type: TabStopType.RIGHT, position: rightTabStop(style) }],
            children: [
              new TextRun({ text: degreeLine, size: 20, font: fontOf(style), color: '1F2937' }),
              new TextRun({ text: '\t' }),
              new TextRun({ text: eduLoc, size: 18, font: fontOf(style), color: '4B5563' }),
            ],
          }),
        )
      } else if (eduLoc) {
        children.push(bodyPara(eduLoc, { after: 60, run: { size: 18, color: '4B5563' } }, style))
      }
    }
  }

  const pageBorders = style.pageBorder
    ? {
        pageBorders: {
          pageBorderTop: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 18 },
          pageBorderRight: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 18 },
          pageBorderBottom: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 18 },
          pageBorderLeft: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 18 },
        },
      }
    : {}

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'resume-bullets',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: {
                    left: convertInchesToTwip(0.25),
                    hanging: convertInchesToTwip(0.15),
                  },
                },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(margin),
              bottom: convertInchesToTwip(margin),
              left: convertInchesToTwip(margin),
              right: convertInchesToTwip(margin),
            },
            ...pageBorders,
          },
        },
        children,
      },
    ],
  })

  return Packer.toBuffer(doc)
}

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
} from 'docx'
import { getTemplateStyle } from './resumeTemplates.js'

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

function formatDates(start, end) {
  const s = clean(start)
  const e = clean(end) || 'Present'
  if (!s && !e) return ''
  if (!s) return e
  return `${s} – ${e}`
}

function formatCityState(city, state) {
  return [clean(city), clean(state)].filter(Boolean).join(', ')
}

function sectionHeading(text, accent, compact, style = {}) {
  const isClassic = style.headingStyle === 'underline-colon'
  const label = isClassic ? `${text.toUpperCase()}:` : text.toUpperCase()

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
        size: 22,
        font: 'Calibri',
        color: accent,
        underline: isClassic ? {} : undefined,
      }),
    ],
  })
}

function bodyPara(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 60 },
    children: [
      new TextRun({
        text: clean(text),
        size: 20,
        font: 'Calibri',
        color: '1F2937',
        ...opts.run,
      }),
    ],
  })
}

function bulletPara(text, compact) {
  return new Paragraph({
    spacing: { after: compact ? 24 : 40 },
    indent: { left: convertInchesToTwip(0.15) },
    children: [
      new TextRun({
        text: `• ${clean(text)}`,
        size: compact ? 18 : 20,
        font: 'Calibri',
        color: '1F2937',
      }),
    ],
  })
}

function contactLine(resume, style = {}) {
  if (style.contactStyle === 'phone-email') {
    return [clean(resume.phone), clean(resume.email)].filter(Boolean).join('  |  ')
  }
  const bits = [
    clean(resume.location),
    clean(resume.phone),
    clean(resume.email),
    clean(resume.linkedin),
  ].filter(Boolean)
  return bits.join('  |  ')
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
            font: 'Calibri',
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
              font: 'Calibri',
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
              font: 'Calibri',
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
          font: 'Calibri',
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
            font: 'Calibri',
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
            font: 'Calibri',
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
            font: 'Calibri',
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

function buildExperienceEntry(job, style, compact) {
  const accent = style.forceBlack ? '000000' : (style.accent || '1E40AF')
  const ink = style.forceBlack ? '000000' : '111827'
  const muted = style.forceBlack ? '000000' : '4B5563'
  const companyColor = style.forceBlack ? '000000' : accent
  const company = clean(job.company)
  const title = clean(job.title)
  const dates = clean(job.dates) || formatDates(job.startDate, job.endDate)
  const loc = clean(job.location) || formatCityState(job.city, job.state)
  const paras = []
  const layout = style.experienceLayout || 'title-dates'

  if (layout === 'company-first') {
    paras.push(
      new Paragraph({
        spacing: { before: compact ? 80 : 120, after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.RIGHT }],
        children: [
          new TextRun({ text: loc ? `${company} – ${loc}` : company, bold: true, size: 20, font: 'Calibri', color: ink }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: dates, bold: true, size: 18, font: 'Calibri', color: ink }),
        ],
      }),
    )
    if (title) {
      paras.push(
        new Paragraph({
          spacing: { after: style.showResponsibilitiesLabel ? 20 : 40 },
          children: [
            new TextRun({
              text: title,
              italics: !style.showResponsibilitiesLabel,
              bold: true,
              size: 20,
              font: 'Calibri',
              color: '000000',
            }),
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
              font: 'Calibri',
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
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.RIGHT }],
        children: [
          new TextRun({
            text: [title, company].filter(Boolean).join(' | '),
            bold: true,
            size: 20,
            font: 'Calibri',
            color: ink,
          }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: dates, bold: true, size: 18, font: 'Calibri', color: ink }),
        ],
      }),
    )
    if (loc) {
      paras.push(bodyPara(loc, { after: 40, run: { size: 18, color: muted } }))
    }
  } else if (layout === 'title-company-split') {
    paras.push(
      new Paragraph({
        spacing: { before: compact ? 80 : 120, after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.RIGHT }],
        children: [
          new TextRun({ text: title, bold: true, size: 20, font: 'Calibri', color: ink }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: dates, bold: true, size: 18, font: 'Calibri', color: ink }),
        ],
      }),
    )
    paras.push(
      new Paragraph({
        spacing: { after: 40 },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.RIGHT }],
        children: [
          new TextRun({ text: company, bold: true, size: 20, font: 'Calibri', color: companyColor }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: loc, size: 18, font: 'Calibri', color: muted }),
        ],
      }),
    )
  } else {
    // title-dates (default / classic-blue / modern-data / teal)
    paras.push(
      new Paragraph({
        spacing: { before: compact ? 80 : 120, after: 20 },
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.RIGHT }],
        children: [
          new TextRun({ text: title, bold: true, size: 20, font: 'Calibri', color: ink }),
          new TextRun({ text: '\t' }),
          new TextRun({ text: dates, size: 18, font: 'Calibri', color: companyColor, italics: true }),
        ],
      }),
    )
    const companyLine = [company, loc].filter(Boolean).join(' | ')
    if (companyLine) {
      paras.push(
        new Paragraph({
          spacing: { after: 40 },
          children: [
            new TextRun({ text: companyLine, size: 20, font: 'Calibri', color: muted, italics: true }),
          ],
        }),
      )
    }
  }

  for (const b of (job.bullets || []).map(clean).filter(Boolean)) {
    paras.push(bulletPara(b, compact))
  }
  return paras
}

/**
 * Build a professional DOCX from structured resume JSON + template id.
 * @param {object} [options]
 * @param {boolean} [options.forceBlack] — JD Builder: all text/accents black only
 */
export async function generateResumeDocx(resume, templateId = 'classic-blue', options = {}) {
  let style = { ...getTemplateStyle(templateId) }
  if (options.forceBlack) {
    style = {
      ...style,
      accent: '000000',
      nameColor: '000000',
      forceBlack: true,
      // Avoid colored banner headers
      headerStyle: style.headerStyle === 'banner' ? 'centered' : style.headerStyle,
    }
  }
  const accent = style.accent || '1E40AF'
  const compact = !!style.compact
  const children = []

  children.push(...buildHeader(resume, style))

  const summaryText = clean(resume.summary)
  const summaryBullets = Array.isArray(resume.summaryBullets)
    ? resume.summaryBullets.map(clean).filter(Boolean)
    : []

  if (summaryText || summaryBullets.length) {
    children.push(sectionHeading('Professional Summary', accent, compact, style))
    if (summaryText && !summaryBullets.length) {
      children.push(bodyPara(summaryText, { after: 80 }))
    }
    for (const b of summaryBullets) children.push(bulletPara(b, compact))
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
              spacing: { after: compact ? 24 : 40 },
              indent: { left: convertInchesToTwip(0.15) },
              children: [
                new TextRun({ text: '• ', size: compact ? 18 : 20, font: 'Calibri', color: '000000' }),
                new TextRun({ text: `${label}: `, bold: true, size: compact ? 18 : 20, font: 'Calibri', color: '000000' }),
                new TextRun({ text: items.join(', '), size: compact ? 18 : 20, font: 'Calibri', color: '000000' }),
              ],
            }),
          )
        } else {
          children.push(
            new Paragraph({
              spacing: { after: 40 },
              children: [
                new TextRun({ text: `${label}: `, bold: true, size: 20, font: 'Calibri', color: accent }),
                new TextRun({
                  text: items.join(', '),
                  size: 20,
                  font: 'Calibri',
                  color: style.forceBlack ? '000000' : '1F2937',
                }),
              ],
            }),
          )
        }
      }
    } else {
      children.push(bodyPara(flatSkills.join(' · '), { after: 80 }))
    }
  }

  const experience = Array.isArray(resume.experience) ? resume.experience : []
  if (experience.length) {
    children.push(sectionHeading('Professional Experience', accent, compact, style))
    for (const job of experience) {
      children.push(...buildExperienceEntry(job, style, compact))
    }
  }

  const education = Array.isArray(resume.education) ? resume.education : []
  if (education.length) {
    children.push(sectionHeading('Education', accent, compact, style))
    for (const edu of education) {
      if (typeof edu === 'string') {
        children.push(bodyPara(edu, { after: 60 }))
        continue
      }
      const school = clean(edu.school || edu.university || edu.college)
      const degree = clean(edu.degree)
      const course = clean(edu.course || edu.field)
      const dates = clean(edu.dates) || formatDates(edu.startDate, edu.endDate)
      const line1 = [degree, course].filter(Boolean).join(' in ')

      children.push(
        new Paragraph({
          spacing: { before: 80, after: 20 },
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.RIGHT }],
          children: [
            new TextRun({ text: line1 || school, bold: true, size: 20, font: 'Calibri', color: '111827' }),
            new TextRun({ text: '\t' }),
            new TextRun({ text: dates, size: 18, font: 'Calibri', color: '4B5563' }),
          ],
        }),
      )
      if (line1 && school) {
        children.push(bodyPara(school, { after: 60 }))
      }
    }
  }

  const margin = style.pageBorder ? 0.75 : (compact ? 0.55 : 0.7)
  const pageBorders = style.pageBorder
    ? {
        pageBorders: {
          pageBorderTop: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 24 },
          pageBorderRight: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 24 },
          pageBorderBottom: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 24 },
          pageBorderLeft: { style: BorderStyle.SINGLE, size: 12, color: '000000', space: 24 },
        },
      }
    : {}

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(margin),
              bottom: convertInchesToTwip(margin),
              left: convertInchesToTwip(0.7),
              right: convertInchesToTwip(0.7),
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

import PizZip from 'pizzip'

export const SAMPLE_DUMMY = {
  name: 'Alex Morgan',
  nameUpper: 'ALEX MORGAN',
  email: 'alex.morgan@email.com',
  phone: '(555) 123-4567',
  linkedin: 'linkedin.com/in/alexmorgan',
  linkedinUrl: 'https://linkedin.com/in/alexmorgan',
  location: 'Austin, TX',
}

const SECTION_HEADINGS = new Set([
  'summary', 'professional summary', 'profile', 'objective', 'profile summary',
  'experience', 'work experience', 'professional experience',
  'education', 'skills', 'technical skills', 'projects',
  'certifications', 'certification', 'awards', 'languages',
])

function unescapeXml(text) {
  return (text || '')
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Collect PII from each paragraph separately so adjacent paragraphs are not glued. */
function detectContactFields(xml) {
  const emails = new Set()
  const phones = new Set()
  const linkedins = new Set()
  for (const m of xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const text = [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((t) => unescapeXml(t[1]))
      .join('')
    if (!text.trim()) continue
    for (const e of detectEmails(text)) emails.add(e)
    for (const p of detectPhones(text)) phones.add(p)
    for (const li of detectLinkedIns(text)) linkedins.add(li)
  }
  return {
    emails: [...emails],
    phones: [...phones],
    linkedins: [...linkedins],
  }
}

function extractEarlyParagraphs(xml, limit = 10) {
  const paras = []
  for (const m of xml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const text = [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
      .map((t) => unescapeXml(t[1]))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    paras.push(text)
    if (paras.length >= limit) break
  }
  return paras
}

function looksLikeName(text) {
  const t = (text || '').trim()
  if (!t || t.length < 4 || t.length > 48) return false
  if (SECTION_HEADINGS.has(t.toLowerCase())) return false
  if (/[@\d]|https?:|linkedin|www\./i.test(t)) return false
  if (/[,:;|]/.test(t) && t.split(/[,:;|]/).length > 2) return false
  const words = t.split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 4) return false
  const nameLike = words.every((w) => /^[A-Za-z][A-Za-z'.-]*$/.test(w))
  if (!nameLike) return false
  return words.every((w) => /^[A-Z]/.test(w))
}

function detectName(xml) {
  const early = extractEarlyParagraphs(xml, 12)
  for (const p of early) {
    if (/[|•]/.test(p) || /@/.test(p) || /\d{3}/.test(p)) continue
    if (looksLikeName(p)) return p.trim()
  }
  return null
}

function detectEmails(text) {
  // Use known TLDs (not a greedy [A-Z]{2,}) so "email.comSUMMARY" still matches
  // "email.com" and does not swallow the following heading.
  const matches =
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.(?:com|org|net|edu|io|gov|us|in|info|biz)/gi) || []
  return [...new Set(matches)]
}

function detectPhones(text) {
  const matches =
    text.match(/(?:\+?\d{1,2}[\s.-]*)?(?:\(?\d{3}\)?[\s.-]*)\d{3}[\s.-]*\d{4}(?!\d)/g) || []
  return [...new Set(matches.map((m) => m.trim()).filter((m) => m.replace(/\D/g, '').length >= 10))]
}

function detectLinkedIns(text) {
  // Allow stray spaces inside the path (Word sometimes inserts them between runs)
  const matches =
    text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/\s*[A-Za-z0-9_-]+\/?/gi) || []
  return [...new Set(matches)]
}

function buildNameVariants(name) {
  const variants = new Set()
  const trimmed = name.trim()
  variants.add(trimmed)
  variants.add(trimmed.toUpperCase())
  variants.add(trimmed.toLowerCase())
  variants.add(trimmed.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
  return [...variants].filter((v) => v.length >= 3)
}

/**
 * Replace one occurrence of `from` that may span multiple <w:t> runs
 * (and even paragraph boundaries). Puts `to` in the first run of the span.
 */
function replaceOnceAcrossRuns(xml, from, to) {
  if (!from) return xml

  const re = /<w:t([^>]*)>([^<]*)<\/w:t>/g
  const nodes = []
  let m
  while ((m = re.exec(xml)) !== null) {
    nodes.push({
      start: m.index,
      end: m.index + m[0].length,
      attrs: m[1],
      text: unescapeXml(m[2]),
    })
  }
  if (!nodes.length) return xml

  const plain = nodes.map((n) => n.text).join('')
  const idx = plain.indexOf(from)
  if (idx < 0) return xml

  const end = idx + from.length
  const charToNode = []
  nodes.forEach((n, i) => {
    for (let c = 0; c < n.text.length; c++) charToNode.push(i)
  })

  const firstNode = charToNode[idx]
  const lastNode = charToNode[end - 1]
  if (firstNode == null || lastNode == null) return xml

  let offset = 0
  for (let i = 0; i < firstNode; i++) offset += nodes[i].text.length
  const localStart = idx - offset

  let offsetLast = 0
  for (let i = 0; i < lastNode; i++) offsetLast += nodes[i].text.length
  const localEnd = end - offsetLast

  const texts = nodes.map((n) => n.text)
  if (firstNode === lastNode) {
    texts[firstNode] = texts[firstNode].slice(0, localStart) + to + texts[firstNode].slice(localEnd)
  } else {
    texts[firstNode] = texts[firstNode].slice(0, localStart) + to
    for (let i = firstNode + 1; i < lastNode; i++) texts[i] = ''
    texts[lastNode] = texts[lastNode].slice(localEnd)
  }

  let out = xml
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    const body = texts[i]
    const needPreserve = /^\s|\s$/.test(body) || body.includes('  ')
    const attrs =
      needPreserve && !/\bxml:space=/.test(n.attrs) ? `${n.attrs} xml:space="preserve"` : n.attrs
    out = `${out.slice(0, n.start)}<w:t${attrs}>${escapeXml(body)}</w:t>${out.slice(n.end)}`
  }
  return out
}

function replaceAllAcrossRuns(xml, from, to) {
  if (!from || from === to) return xml
  let current = xml
  for (let guard = 0; guard < 50; guard++) {
    const next = replaceOnceAcrossRuns(current, from, to)
    if (next === current) break
    current = next
  }
  return current
}

function anonymizeXmlDocument(xml, targets) {
  let out = xml
  for (const { from, to } of targets) {
    out = replaceAllAcrossRuns(out, from, to)
  }
  return out
}

/**
 * Replace personal info in a sample DOCX with dummy Alex Morgan details.
 * Layout/formatting stays intact — only text content changes.
 */
export function anonymizeSampleDocx(buffer) {
  const zip = new PizZip(buffer)
  const docFile = zip.file('word/document.xml')
  if (!docFile) return { buffer, meta: { anonymized: false, reason: 'no_document_xml' } }

  const docXml = docFile.asText()
  const detectedName = detectName(docXml)

  const nameTargets = []
  if (detectedName) {
    for (const variant of buildNameVariants(detectedName)) {
      nameTargets.push({
        from: variant,
        to: variant === variant.toUpperCase() ? SAMPLE_DUMMY.nameUpper : SAMPLE_DUMMY.name,
      })
    }
    nameTargets.sort((a, b) => b.from.length - a.from.length)
  }

  const xmlPaths = Object.keys(zip.files).filter((p) =>
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(p),
  )

  // Pass 1: replace names first so glued "LASTNAMEemail@..." becomes "email@..."
  for (const path of xmlPaths) {
    let xml = zip.file(path).asText()
    xml = anonymizeXmlDocument(xml, nameTargets)
    zip.file(path, xml)
  }

  // Pass 2: re-scan per-paragraph and replace contact PII
  const docAfterName = zip.file('word/document.xml').asText()
  const { emails, phones, linkedins } = detectContactFields(docAfterName)

  const contactTargets = []
  for (const email of emails) {
    contactTargets.push({ from: email, to: SAMPLE_DUMMY.email })
  }
  for (const phone of phones) {
    contactTargets.push({ from: phone, to: SAMPLE_DUMMY.phone })
  }
  for (const li of linkedins) {
    const to = /^https?:/i.test(li) ? SAMPLE_DUMMY.linkedinUrl : SAMPLE_DUMMY.linkedin
    contactTargets.push({ from: li, to })
  }
  contactTargets.sort((a, b) => b.from.length - a.from.length)

  for (const path of xmlPaths) {
    let xml = zip.file(path).asText()
    xml = anonymizeXmlDocument(xml, contactTargets)
    zip.file(path, xml)
  }

  return {
    buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
    meta: {
      anonymized: true,
      replacedName: detectedName || null,
      replacedEmails: emails.length,
      replacedPhones: phones.length,
      dummyName: SAMPLE_DUMMY.name,
    },
  }
}

/** Anonymize if DOCX; pass PDF through unchanged. */
export function anonymizeSampleBuffer(buffer, fileType) {
  if (fileType !== 'docx') {
    return { buffer, meta: { anonymized: false, reason: 'pdf_passthrough' } }
  }
  try {
    return anonymizeSampleDocx(buffer)
  } catch (err) {
    console.warn('[sampleAnonymize] failed, serving original:', err.message)
    return { buffer, meta: { anonymized: false, reason: err.message } }
  }
}

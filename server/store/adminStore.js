import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { TEMPLATE_STYLES } from '../services/resumeTemplates.js'
import { anonymizeSampleBuffer } from '../services/sampleAnonymize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '../admin-data')
const SAMPLES_DIR = path.join(DATA_DIR, 'samples')
const PRICING_PATH = path.join(DATA_DIR, 'pricing.json')
const SAMPLES_META_PATH = path.join(DATA_DIR, 'samples-meta.json')
const COMPLIMENTARY_PATH = path.join(DATA_DIR, 'complimentary-emails.json')

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const DEFAULT_PRICING = {
  plans: [
    {
      id: 'starter',
      name: 'Free',
      price: '0',
      period: 'forever',
      desc: 'Get started with monthly limits that cover most job searches',
      features: [
        '10 resume enhancements per month',
        '5 resume builds per month',
        '5 JD-tailored resumes per month',
        'ATS score report',
        'DOCX export',
      ],
      cta: 'Start Free',
      featured: false,
    },
    {
      id: 'professional',
      name: 'Professional',
      price: '19',
      period: '/month',
      desc: 'For active job seekers who need more power',
      features: [
        'Unlimited resume enhancements',
        'Unlimited resume builds',
        'Unlimited JD-tailored resumes',
        'Full ATS analysis & suggestions',
        'All premium templates',
        'Priority support',
      ],
      cta: 'Get Professional',
      featured: true,
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      price: '49',
      period: '/month',
      desc: 'For career coaches and recruiting teams',
      features: [
        'Everything in Professional',
        'Team dashboard & analytics',
        'White-label exports',
        'API access',
        'Dedicated account manager',
      ],
      cta: 'Contact Sales',
      featured: false,
    },
  ],
}

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
  if (!fs.existsSync(SAMPLES_DIR)) fs.mkdirSync(SAMPLES_DIR, { recursive: true })
}

function readJson(filePath, fallback) {
  ensureDirs()
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2))
    return structuredClone(fallback)
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return structuredClone(fallback)
  }
}

function writeJson(filePath, data) {
  ensureDirs()
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

export function getTemplateIds() {
  return Object.keys(TEMPLATE_STYLES)
}

export function getPricing() {
  const data = readJson(PRICING_PATH, DEFAULT_PRICING)
  if (!Array.isArray(data.plans) || data.plans.length === 0) {
    return structuredClone(DEFAULT_PRICING)
  }
  return data
}

export function savePricing(plans) {
  if (!Array.isArray(plans) || plans.length === 0) {
    throw Object.assign(new Error('At least one plan is required'), { status: 400 })
  }
  for (const plan of plans) {
    if (!String(plan.name || '').trim()) {
      throw Object.assign(new Error('Each plan needs a name'), { status: 400 })
    }
    if (plan.price === undefined || plan.price === null || String(plan.price).trim() === '') {
      throw Object.assign(new Error(`Plan "${plan.name}" needs a price`), { status: 400 })
    }
    if (!Array.isArray(plan.features)) {
      throw Object.assign(new Error(`Plan "${plan.name}" features must be a list`), { status: 400 })
    }
  }
  const normalized = {
    plans: plans.map((plan, i) => ({
      id: String(plan.id || plan.name || `plan-${i}`).toLowerCase().replace(/\s+/g, '-'),
      name: String(plan.name).trim(),
      price: String(plan.price).trim(),
      period: String(plan.period || '/month').trim(),
      desc: String(plan.desc || '').trim(),
      features: plan.features.map((f) => String(f).trim()).filter(Boolean),
      cta: String(plan.cta || 'Get started').trim(),
      featured: Boolean(plan.featured),
    })),
  }
  writeJson(PRICING_PATH, normalized)
  return normalized
}

function getSamplesMeta() {
  return readJson(SAMPLES_META_PATH, { samples: {} })
}

function saveSamplesMeta(meta) {
  writeJson(SAMPLES_META_PATH, meta)
}

export function listSamples() {
  const meta = getSamplesMeta()
  const samples = {}
  for (const [templateId, info] of Object.entries(meta.samples || {})) {
    const filePath = path.join(SAMPLES_DIR, info.storedName)
    if (fs.existsSync(filePath)) {
      samples[templateId] = {
        templateId,
        fileName: info.fileName,
        fileType: info.fileType,
        uploadedAt: info.uploadedAt,
        size: info.size,
      }
    }
  }
  return samples
}

export function getSample(templateId) {
  const meta = getSamplesMeta()
  const info = meta.samples?.[templateId]
  if (!info) return null
  const filePath = path.join(SAMPLES_DIR, info.storedName)
  if (!fs.existsSync(filePath)) return null
  return {
    ...info,
    templateId,
    filePath,
    buffer: fs.readFileSync(filePath),
  }
}

export function saveSample(templateId, fileName, fileType, buffer) {
  if (!TEMPLATE_STYLES[templateId]) {
    throw Object.assign(new Error('Unknown template id'), { status: 404 })
  }
  ensureDirs()
  const ext = fileType === 'pdf' ? 'pdf' : 'docx'
  const storedName = `${templateId}.${ext}`
  const filePath = path.join(SAMPLES_DIR, storedName)

  // Remove previous sample with a different extension
  for (const old of fs.readdirSync(SAMPLES_DIR)) {
    if (old.startsWith(`${templateId}.`) && old !== storedName) {
      fs.unlinkSync(path.join(SAMPLES_DIR, old))
    }
  }

  // Store anonymized DOCX so public previews never show real personal info
  const { buffer: safeBuffer, meta: anonMeta } = anonymizeSampleBuffer(buffer, fileType)
  fs.writeFileSync(filePath, safeBuffer)

  const meta = getSamplesMeta()
  meta.samples = meta.samples || {}
  meta.samples[templateId] = {
    fileName,
    fileType,
    storedName,
    size: safeBuffer.length,
    uploadedAt: new Date().toISOString(),
    anonymized: Boolean(anonMeta?.anonymized),
    dummyName: anonMeta?.dummyName || null,
  }
  saveSamplesMeta(meta)

  return {
    templateId,
    fileName,
    fileType,
    uploadedAt: meta.samples[templateId].uploadedAt,
    size: safeBuffer.length,
    anonymized: meta.samples[templateId].anonymized,
  }
}

export function deleteSample(templateId) {
  const meta = getSamplesMeta()
  const info = meta.samples?.[templateId]
  if (!info) {
    throw Object.assign(new Error('No sample for this template'), { status: 404 })
  }
  const filePath = path.join(SAMPLES_DIR, info.storedName)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  delete meta.samples[templateId]
  saveSamplesMeta(meta)
  return { ok: true }
}

function normalizeComplimentaryEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function getComplimentaryData() {
  return readJson(COMPLIMENTARY_PATH, { entries: [] })
}

function saveComplimentaryData(data) {
  writeJson(COMPLIMENTARY_PATH, data)
}

/** Emails that receive free Professional (unlimited) access. */
export function listComplimentaryEmails() {
  const data = getComplimentaryData()
  const entries = Array.isArray(data.entries) ? data.entries : []
  return entries
    .map((e) => ({
      email: normalizeComplimentaryEmail(e.email),
      note: String(e.note || '').trim(),
      addedAt: e.addedAt || null,
    }))
    .filter((e) => e.email)
    .sort((a, b) => a.email.localeCompare(b.email))
}

export function isComplimentaryEmail(email) {
  const normalized = normalizeComplimentaryEmail(email)
  if (!normalized) return false
  return listComplimentaryEmails().some((e) => e.email === normalized)
}

export function addComplimentaryEmail(email, note = '') {
  const normalized = normalizeComplimentaryEmail(email)
  if (!normalized || !EMAIL_RE.test(normalized)) {
    throw Object.assign(new Error('Enter a valid email address'), { status: 400 })
  }
  const data = getComplimentaryData()
  const entries = Array.isArray(data.entries) ? data.entries : []
  const existing = entries.find((e) => normalizeComplimentaryEmail(e.email) === normalized)
  if (existing) {
    existing.note = String(note || existing.note || '').trim()
    saveComplimentaryData({ entries })
    return {
      email: normalized,
      note: existing.note,
      addedAt: existing.addedAt || null,
      updated: true,
    }
  }
  const entry = {
    email: normalized,
    note: String(note || '').trim(),
    addedAt: new Date().toISOString(),
  }
  entries.push(entry)
  saveComplimentaryData({ entries })
  return { ...entry, updated: false }
}

export function removeComplimentaryEmail(email) {
  const normalized = normalizeComplimentaryEmail(email)
  const data = getComplimentaryData()
  const entries = Array.isArray(data.entries) ? data.entries : []
  const next = entries.filter((e) => normalizeComplimentaryEmail(e.email) !== normalized)
  if (next.length === entries.length) {
    throw Object.assign(new Error('Email is not on the complimentary list'), { status: 404 })
  }
  saveComplimentaryData({ entries: next })
  return { ok: true }
}

export { DEFAULT_PRICING }

import { extractJdBasicsFromText, mapJdBasicsFromResume } from '../server/services/jdBasicsExtract.js'

const sample = `SHIVA KUMAR CHERPALLI
New Berlin, WI | 480-913-6670 | cherpallishiva58@gmail.com
linkedin.com/in/shivakumar

PROFESSIONAL SUMMARY
• 4+ years of progressive experience across software engineering, cloud automation, AI platform work
• Built REST APIs and deployed on AWS

EXPERIENCE
FDE Engineer | Jan 2025 – Present
• Did stuff

EDUCATION
Master of Science in Computer Science and Information Systems
Jan 2022 – Jan 2024
Concordia University Wisconsin
Mequon, WI

SKILLS
Python, SQL
`

const a = extractJdBasicsFromText(sample)
console.log('text-first:', JSON.stringify(a, null, 2))

const b = mapJdBasicsFromResume({
  name: 'SHIVA',
  location: '• 4+ years of progressive experience across software engineering, cloud automation, AI platform i',
  education: [
    'Master of Science in Computer Science and Information Systems Jan',
    'Mequon',
    'Concordia University Wisconsin Mequon',
  ],
}, sample)
console.log('mapped:', JSON.stringify(b, null, 2))

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
assert(a.city === 'New Berlin', `city=${a.city}`)
assert(a.state === 'WI', `state=${a.state}`)
assert(a.education.length === 1, `edu count=${a.education.length}`)
assert(/Concordia/i.test(a.education[0].school), `school=${a.education[0].school}`)
assert(!/Jan/i.test(a.education[0].degree), `degree=${a.education[0].degree}`)
assert(!/Mequon/i.test(a.education[0].major || ''), `major=${a.education[0].major}`)
assert(b.city === 'New Berlin', `mapped city=${b.city}`)
assert(b.education.length === 1, `mapped edu=${b.education.length}`)
console.log('OK')

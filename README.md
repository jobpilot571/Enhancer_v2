# JoBPilot.AI

Premium resume automation platform with a real **Resume Enhancer** backend service.

## Resume Enhancer Service

Full workflow:
1. Upload `.docx` resume → real Word-style preview via `docx-preview`
2. Internal structured JSON parsing (OpenAI) — never shown as plain text preview
3. Paste job description → JD structured parsing
4. Skill match analysis (present / missing / strong / weak)
5. AI enhancement plan (summary bullets, experience bullets, skill additions, rewrites)
6. Patch original DOCX with PizZip (preserves formatting, yellow highlights on new content)
7. Enhanced preview + DOCX download

## Setup

```bash
npm install
cp .env.example .env
# Add your OPENAI_API_KEY to .env
```

## Run

```bash
# Terminal 1 — API server (port 3001)
npm run server

# Terminal 2 — Frontend (port 5173)
npm run dev

# Or both together:
npm run dev:all
```

Open http://localhost:5173/services/resume-enhancer

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/enhancer/upload` | Upload `.docx` resume |
| PUT | `/api/enhancer/jd` | Set job description text |
| POST | `/api/enhancer/analyze` | Parse resume + JD, skill match |
| POST | `/api/enhancer/enhance` | Generate enhanced DOCX |
| GET | `/api/enhancer/file/:id/:type` | Get original or enhanced DOCX |
| GET | `/api/enhancer/download/:id` | Download enhanced DOCX |

## Environment Variables

```
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
PORT=3001
```

## Tech Stack

- **Frontend:** React, Vite, docx-preview
- **Backend:** Express, mammoth, pizzip, OpenAI API
- **Preview:** Real DOCX rendering (not extracted text)
- **Enhancement:** Original DOCX patching (format preserved)

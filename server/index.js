import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import translateRouter from './routes/translate.js'
import jobsRouter from './routes/jobs.js'
import { getJobsRoot } from './lib/storage.js'

const PORT = Number(process.env.PORT) || 3001
const app = express()

// Büyük JSON yüklerini destekle — bazı en.json'lar 250KB+ olabilir.
app.use(express.json({ limit: '10mb' }))

// CORS — Vite dev proxy kullanıyorsa gerekmez ama doğrudan başka origin'den
// gelirse çalışsın diye açık. İstersen prod'da kapat.
app.use(cors())

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    version: '0.1.0',
    jobsDir: getJobsRoot(),
    hasEnvKey: !!process.env.DEEPSEEK_API_KEY,
    ts: new Date().toISOString(),
  })
})

app.use('/api/translate', translateRouter)
app.use('/api/jobs', jobsRouter)

// 404 yakalayıcı
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` })
})

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[server error]', err)
  res.status(err.status || 500).json({ error: err.message || 'Internal error' })
})

app.listen(PORT, () => {
  console.log(`[diress-locale-translator] listening on http://localhost:${PORT}`)
  console.log(`[diress-locale-translator] jobs dir: ${getJobsRoot()}`)
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn(
      '[diress-locale-translator] DEEPSEEK_API_KEY not set in .env — client must send Authorization header.',
    )
  }
})

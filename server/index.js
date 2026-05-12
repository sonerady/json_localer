import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import jobsRouter from './routes/jobs.js'
import { getJobsRoot } from './lib/storage.js'
import { autoResumeIncompleteJobs } from './lib/jobRunner.js'

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

app.listen(PORT, async () => {
  console.log(`[diress-locale-translator] listening on http://localhost:${PORT}`)
  console.log(`[diress-locale-translator] jobs dir: ${getJobsRoot()}`)
  if (!process.env.DEEPSEEK_API_KEY) {
    console.warn(
      '[diress-locale-translator] DEEPSEEK_API_KEY not set in .env — translations will fail.',
    )
  }

  // Server restart sonrası diskte yarım kalan job'ları otomatik yeniden başlat.
  // Bu sayede Render redeploy / crash durumlarında çeviri devam eder.
  try {
    const result = await autoResumeIncompleteJobs()
    if (result.resumed.length) {
      console.log(
        `[auto-resume] ${result.resumed.length} job resumed: ${result.resumed
          .map((r) => `${r.jobId}(${r.langCount})`)
          .join(', ')}`,
      )
    }
    if (result.skipped.length) {
      console.log(`[auto-resume] ${result.skipped.length} skipped`)
    }
  } catch (e) {
    console.error('[auto-resume failed]', e?.message || e)
  }
})

// POST /api/translate/chunk
//
// AKIŞ (single round-trip, server-authoritative):
//   1) Eğer client `templateInit` yolladıysa → ilk chunk demektir, diskte
//      <jobId>/<lang>.json yoksa template'ı tohum olarak yaz.
//   2) Diskten mevcut snapshot'ı oku (yoksa templateInit veya {} kullan).
//   3) DeepSeek'i çağır → translations al.
//   4) Translations'ı snapshot üzerine path bazlı yaz (setAtPath).
//   5) Yeni snapshot'ı diske ATOMIC yaz. Bu adım client'a yanıt dönmeden ÖNCE
//      tamamlanır → "veriler kesinlikle diske yazıldıgıyla kalmalı" garantisi.
//   6) Progress'i diske yaz.
//   7) Client'a { translations, snapshot, usage } döner.
//
// Bu sayede browser/process her an die'lasa bile son başarılı chunk'a kadar
// olan tüm çeviriler diskte güvenle bulunur.

import { Router } from 'express'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { translateChunk } from '../lib/deepseek.js'
import { parseKeyToPath, setAtPath } from '../lib/jsonChunk.js'
import {
  ensureJobDir,
  getJobDir,
  readLangSnapshot,
  saveLangProgress,
  saveLangSnapshot,
  saveMeta,
  validateJobId,
  validateLang,
  writeJsonAtomic,
} from '../lib/storage.js'

const router = Router()

function extractApiKey(req) {
  const h = req.get('authorization') || ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : null
}

router.post('/chunk', async (req, res) => {
  const {
    payload,
    target,
    model,
    jobId,
    lang,
    templateInit,
    progress,
    meta,
  } = req.body || {}

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'payload (object) required' })
  }
  if (!target || !target.language || !target.nativeName) {
    return res.status(400).json({ error: 'target { language, nativeName } required' })
  }
  if (!jobId || !lang) {
    return res.status(400).json({ error: 'jobId and lang required' })
  }
  try {
    validateJobId(jobId)
    validateLang(lang)
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }

  const apiKey = extractApiKey(req)

  try {
    // 1) Job dir + meta (ilk geçişte)
    await ensureJobDir(jobId)
    if (meta) {
      await saveMeta(jobId, meta).catch((e) =>
        console.warn(`[meta write failed] ${jobId}:`, e.message),
      )
    }

    // 2) Snapshot'ı diskten oku — yoksa templateInit'i tohumla
    let snapshot
    const snapPath = path.join(getJobDir(jobId), `${lang}.json`)
    try {
      snapshot = JSON.parse(await fs.readFile(snapPath, 'utf8'))
    } catch {
      if (templateInit && typeof templateInit === 'object') {
        snapshot = templateInit
        // Tohum template'ı hemen diske yaz — ilk chunk başarısız olsa bile
        // structure dosyada kalır.
        await writeJsonAtomic(snapPath, snapshot)
      } else {
        snapshot = {}
      }
    }

    // 3) DeepSeek çağrısı
    const { translations, usage } = await translateChunk({
      payload,
      target,
      model,
      apiKey,
    })

    // 4) Translations'ı snapshot'a uygula
    let newSnapshot = snapshot
    let stringsApplied = 0
    for (const [key, val] of Object.entries(translations)) {
      if (typeof val !== 'string') continue
      try {
        const p = parseKeyToPath(key)
        newSnapshot = setAtPath(newSnapshot, p, val)
        stringsApplied++
      } catch (e) {
        console.warn(`[setAtPath skip] ${key}:`, e.message)
      }
    }

    // 5) ATOMIC disk yazımı — yanıt dönmeden ÖNCE
    await saveLangSnapshot(jobId, lang, newSnapshot)

    // 6) Progress
    if (progress) {
      await saveLangProgress(jobId, lang, {
        ...progress,
        stringsApplied,
        lastChunkAt: new Date().toISOString(),
      }).catch((e) => console.warn(`[progress write failed]:`, e.message))
    }

    // 7) Client'a dön
    res.json({
      translations,
      snapshot: newSnapshot,
      stringsApplied,
      usage,
    })
  } catch (err) {
    const status = err.status || 500
    console.error('[translate/chunk error]', err.message)
    res.status(status).json({ error: err.message })
  }
})

export default router

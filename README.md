# diress · locale translator

Yerel kullanıma yönelik, **client + backend** olan bir JSON locale çeviri aracı. Kaynak `en.json`'u DeepSeek ile App Store Connect'in desteklediği dillere çevirir. Diress uygulamasının bağlamı sistem prompt'a gömülüdür → sektörel kelime seçimleri daha doğru çıkar.

**Garanti**: Her başarılı chunk, client'a yanıt dönmeden ÖNCE diske atomik yazılır. Tarayıcı kapansa / process die'lasa bile o ana kadar çevrilmiş her şey kalıcı kalır.

---

## Mimari

```
diress-locale-translator/
├── src/                    React + TS + Tailwind v4 client (Vite)
│   ├── components/         UI primitives (resta_ai dil)
│   ├── lib/                jsonChunk, deepseek client, appStoreLocales
│   ├── hooks/              useTranslator (orchestration)
│   └── App.tsx
├── server/                 Express backend
│   ├── routes/
│   │   ├── translate.js    POST /api/translate/chunk  (DeepSeek + diske yaz)
│   │   └── jobs.js         GET/POST/DELETE /api/jobs/...
│   ├── lib/
│   │   ├── deepseek.js     DeepSeek wrapper + system prompt
│   │   ├── storage.js      Atomik disk yazımı (.tmp → rename)
│   │   └── jsonChunk.js    setAtPath, parseKeyToPath
│   ├── jobs/               Runtime: job klasörleri (gitignored)
│   │   └── <jobId>/
│   │       ├── meta.json
│   │       ├── tr.json, de.json, ...     ← her chunk sonrası overwrite
│   │       └── tr.progress.json, ...
│   ├── index.js            Express bootstrap
│   └── .env                DEEPSEEK_API_KEY, PORT, JOBS_DIR
├── vite.config.ts          `/api/*` → http://localhost:3001 proxy
└── package.json            `npm run dev` ikisini birlikte ayağa kaldırır
```

## Kurulum

```bash
cd diress-locale-translator
npm install
npm run server:install     # server/ deps
cp server/.env.example server/.env
# server/.env'i editle: DEEPSEEK_API_KEY ekle
```

## Çalıştır

```bash
npm run dev
```

`concurrently` ile aynı anda:
- **web** (cyan): http://localhost:5173 (Vite client)
- **api** (magenta): http://localhost:3001 (Express backend)

Sadece birini başlatmak için: `npm run dev:web` veya `npm run dev:api`.

## Akış

1. UI'da üst sağdaki rozet "backend bağlı · env-key" gösteriyorsa hazırsın.
2. Sol kart 1'e `en.json` sürükle.
3. Kart 2'de hedef dilleri seç ("Varsayılan 10" kestirme buton var).
4. Üst sağda **Çeviriyi başlat**.
5. Her chunk DeepSeek'ten dönünce backend `server/jobs/<jobId>/<lang>.json`'a atomik yazar; sonra client'a translations + snapshot döner.
6. UI canlı: progress bar, log panel, jobId rozeti.

## Veri kalıcılığı garantisi

```
[client] POST /api/translate/chunk
            ↓
[server] 1. server/jobs/<jobId>/<lang>.json'ı oku (yoksa templateInit'i tohumla)
         2. DeepSeek'i çağır → translations
         3. Translations'ı snapshot üzerine path bazlı yaz
         4. ATOMIC: snapshot'ı diske yaz (.tmp + rename)
         5. Progress dosyasını yaz
         6. RESPONSE: { translations, snapshot, stringsApplied }
            ↑
[client] UI'ı güncelle
```

5. adım client'a yanıt gitmeden ÖNCE tamamlanır. Yani:
- ❌ Browser kapansa
- ❌ Network kopsa
- ❌ Client crash etse

…veri yine diskte. Aynı job ID ile aynı `en.json`'u tekrar yüklersen mevcut snapshot devam ettirilir (gelecek özellik: "resume from disk").

## Job klasör yapısı

```
server/jobs/<jobId>/
├── meta.json                   { jobId, model, chunkSize, targetCodes, createdAt }
├── tr.json                     ← her başarılı chunk sonrası atomik overwrite
├── tr.progress.json            { chunksDone, chunksTotal, stringsDone, status, updatedAt }
├── de.json
├── de.progress.json
└── ...
```

JOBS_DIR env'i ile farklı bir yol verebilirsin (örn. external disk).

## Server endpoint'leri

| Endpoint | Açıklama |
|---|---|
| `GET  /api/health` | Server up + env key kontrolü |
| `POST /api/translate/chunk` | DeepSeek çağrısı + atomik snapshot |
| `GET  /api/jobs` | Tüm job'ları listele |
| `GET  /api/jobs/:id` | Job meta + diller |
| `GET  /api/jobs/:id/snapshot/:lang` | İndir (Content-Disposition: attachment) |
| `GET  /api/jobs/:id/snapshot/:lang/raw` | JSON inline |
| `POST /api/jobs/:id/snapshot/:lang` | Manuel snapshot yaz |
| `DELETE /api/jobs/:id` | Job klasörünü sil |

## Güvenlik

- API key sadece `server/.env` veya browser localStorage'da.
- Backend env key varsa client header'ı gönderse de o öncelikli.
- CORS açık (yerel araç). Prod'a koyacaksan sıkılaştır.

## Geliştirme notu

Client orchestration (`useTranslator.ts`) hâlâ browser'da çalışıyor — server stateful değil, sadece persistent. Daha sonra tam server-side job orchestration + SSE eklersek browser kapalıyken bile çeviri devam edebilir.

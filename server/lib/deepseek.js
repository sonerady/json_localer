// Server-side DeepSeek API çağrısı. Authorization header'ı server tarafında
// .env'den enjekte eder (browser göndermediyse). Hata mesajlarını client'a
// yansıtır ama API key'i loglara koymaz.

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'

export function buildSystemPrompt(target) {
  return [
    `You are a professional UI localization translator for the **Diress** mobile app.`,
    ``,
    `--- APP CONTEXT (use this to choose the right tone, vocabulary and word choices) ---`,
    `Diress is an AI-powered fashion / e-commerce visual generation app for online sellers and small brands.`,
    `Its core jobs-to-be-done:`,
    `• Upload a flat product photo (a dress, t-shirt, jewelry, etc.) → AI generates a model wearing it (Virtual Try-On / "AI model photoshoot").`,
    `• Bulk mode: process many products at once for product catalogs / marketplaces (Amazon, eBay, Trendyol, Shopify, Etsy).`,
    `• Tools include: change product color, background remove, upscale (4K), pose change, refiner / detail editor, "before / after" comparison, infographic & lifestyle scene generation, unboxing & video previews.`,
    `• Subscription model: free credits + a Pro plan ("Diress Pro"). Has paywall / restore / credits / generations history screens.`,
    `Target audience: e-commerce sellers, fashion brands, indie shop owners — NOT consumer fashion shoppers. So the tone is **professional, productive, SaaS, factual** — like Notion or Linear in the local language. Avoid playful or "cute" wording.`,
    ``,
    `--- TRANSLATION TASK ---`,
    `Translate values from English to ${target.language} (${target.nativeName}).`,
    `Apply the app context above when choosing vocabulary. Examples:`,
    `• "model" in this app means an AI-generated human model wearing a product, NOT a 3D mesh or a database model. Use the fashion-industry word in ${target.language}.`,
    `• "generation / generate" refers to producing an AI image — use the natural e-commerce/AI term in ${target.language}, not literal "üretim/üretmek"-style scientific language.`,
    `• "upload" / "drop" / "preview" / "bulk" / "credits" / "Pro" / "paywall" / "checkout" / "subscription" — use whatever native vocabulary an e-commerce SaaS would use in ${target.language} (look at Shopify, Etsy, marketplace seller dashboards localized in ${target.language}).`,
    `• Short labels for badges / buttons must stay short and feel native — do NOT pad them with extra words.`,
    ``,
    `--- LENGTH CONSTRAINT (VERY IMPORTANT) ---`,
    `These strings render inside fixed-width mobile UI containers (buttons, badges, list rows, toolbar items, headers). If the translation is much longer than the English source, it will overflow, truncate with "…", wrap to extra lines, or break layout.`,
    `Therefore: translation length must stay as close to the English source length as possible.`,
    `• Aim for character count within ±15% of the source for short strings (under ~30 chars), within ±25% for medium strings, and roughly comparable for long paragraphs.`,
    `• For very short labels (1–3 words like "Upload", "Pro", "Done", "Cancel"), the translation MUST stay short — pick the most concise native equivalent even if a slightly more descriptive word exists.`,
    `• Never add explanatory parentheticals, never expand abbreviations, never add filler words ("please", "kindly", "lütfen" only if absent in source).`,
    `• If the natural translation would be substantially longer than the source, choose a shorter synonym, drop a non-essential word, or use a common UI-shortening pattern in ${target.language} (e.g. imperative form, dropping articles).`,
    `• If the source is itself abbreviated (e.g. "Bg" for Background), keep the translation similarly abbreviated.`,
    ``,
    `--- STRICT RULES ---`,
    `1. Input is a flat JSON object: { "<path>": "<english source>" }. Return the SAME JSON object with all values translated. Keep keys identical.`,
    `2. Preserve every placeholder, variable, and tag exactly: {{variable}}, {var}, %s, %d, %@, \\n, <tag>, </tag>, <0>, <1>, etc. Do not translate inside placeholders.`,
    `3. Preserve markdown / emoji / punctuation / leading-trailing whitespace exactly as-is.`,
    `4. Brand names and product names must stay untranslated: "Diress", "Diress Pro", "AI", "4K", "RevenueCat", "Apple", "Google", "Amazon", "Shopify", "Etsy", "Instagram", "TikTok", "App Store", "Play Store", file extensions, URLs.`,
    `5. Use natural ${target.language} as written by a native ${target.nativeName} speaker who works in e-commerce / SaaS. Avoid literal or machine-translated phrasing.`,
    `6. Numbers, units, currency symbols stay as-is unless the locale has a different convention (e.g. decimal separator) — when in doubt, keep them exactly as the source.`,
    `7. Respond with ONLY the JSON object. No explanation, no markdown code fences, no extra keys.`,
  ].join('\n')
}

export async function translateChunk({ payload, target, model, apiKey, signal }) {
  const effectiveKey = apiKey || process.env.DEEPSEEK_API_KEY
  if (!effectiveKey) {
    const err = new Error('DeepSeek API key missing (env DEEPSEEK_API_KEY or Authorization header)')
    err.status = 400
    throw err
  }

  const body = {
    model: model || 'deepseek-v4-pro',
    messages: [
      { role: 'system', content: buildSystemPrompt(target) },
      {
        role: 'user',
        content: `Translate the values of this JSON to ${target.language} (${target.nativeName}). Return JSON only.\n\n${JSON.stringify(payload)}`,
      },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
    stream: false,
    // v4-pro default'ta reasoning mode'a giriyor — çeviri için bu hem gereksiz
    // pahalı (~10K reasoning token/chunk) hem yavaş (her chunk dakikalar sürer).
    // Disabled ile normal chat moduna düşer. v4-flash için bu param no-op.
    thinking: { type: 'disabled' },
  }

  const res = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${effectiveKey}`,
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const err = new Error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 400)}`)
    err.status = res.status
    throw err
  }

  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content ?? ''
  if (!content) {
    const err = new Error('DeepSeek empty response')
    err.status = 502
    throw err
  }

  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    const cleaned = content
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim()
    parsed = JSON.parse(cleaned)
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const err = new Error('DeepSeek returned non-object response')
    err.status = 502
    throw err
  }

  return { translations: parsed, usage: data.usage }
}

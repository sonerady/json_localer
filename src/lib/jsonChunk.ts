// Nested JSON'u "leaf path" listesine düzler.
// Sadece string değerleri çevirir; number/boolean/null aynen aktarılır.
export type LeafPath = (string | number)[]
export interface FlatLeaf {
  path: LeafPath
  value: string
}

export function collectStringLeaves(obj: unknown, basePath: LeafPath = []): FlatLeaf[] {
  if (obj === null || obj === undefined) return []
  if (typeof obj === 'string') {
    return [{ path: basePath, value: obj }]
  }
  if (Array.isArray(obj)) {
    return obj.flatMap((item, idx) => collectStringLeaves(item, [...basePath, idx]))
  }
  if (typeof obj === 'object') {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      collectStringLeaves(v, [...basePath, k]),
    )
  }
  return []
}

// Chunk size = aynı anda DeepSeek'e gönderilecek string sayısı.
// İçerik küçük string'lerden oluşuyorsa 60–80 iyi; çok uzunlarda 30 daha güvenli.
export function chunkLeaves(leaves: FlatLeaf[], chunkSize: number): FlatLeaf[][] {
  const chunks: FlatLeaf[][] = []
  for (let i = 0; i < leaves.length; i += chunkSize) {
    chunks.push(leaves.slice(i, i + chunkSize))
  }
  return chunks
}

// Boş bir target template oluştur — yapı (key/array shape) korunur, string'ler boş.
export function buildEmptyTemplate(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return ''
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map((it) => buildEmptyTemplate(it))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    out[k] = buildEmptyTemplate(v)
  }
  return out
}

// Klonlanmış target üzerinde belirli bir path'a değer yazar.
export function setAtPath(root: unknown, path: LeafPath, value: string): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  if (typeof head === 'number') {
    const arr = Array.isArray(root) ? [...root] : []
    while (arr.length <= head) arr.push(undefined)
    arr[head] = setAtPath(arr[head], rest, value)
    return arr
  }
  const obj = root && typeof root === 'object' && !Array.isArray(root)
    ? { ...(root as Record<string, unknown>) }
    : {}
  obj[head] = setAtPath(obj[head], rest, value)
  return obj
}

// Path → DeepSeek'e gönderilecek deterministik string ID (geri map için).
export function pathToKey(path: LeafPath): string {
  return path.map((p) => (typeof p === 'number' ? `[${p}]` : p)).join('.')
}

// Bir chunk'ı request payload formatına çevir.
export function leavesToPayload(chunk: FlatLeaf[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const leaf of chunk) {
    out[pathToKey(leaf.path)] = leaf.value
  }
  return out
}

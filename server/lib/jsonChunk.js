// Nested JSON ağacına path → string yazımı ve leaf collection.
// Client tarafındakinin (jsonChunk.ts) JS karşılığı.

export function setAtPath(root, path, value) {
  if (path.length === 0) return value
  const [head, ...rest] = path
  if (typeof head === 'number') {
    const arr = Array.isArray(root) ? [...root] : []
    while (arr.length <= head) arr.push(undefined)
    arr[head] = setAtPath(arr[head], rest, value)
    return arr
  }
  const obj =
    root && typeof root === 'object' && !Array.isArray(root) ? { ...root } : {}
  obj[head] = setAtPath(obj[head], rest, value)
  return obj
}

// "foo.bar[0].baz" → ["foo", "bar", 0, "baz"]
export function parseKeyToPath(key) {
  const parts = []
  let buf = ''
  for (let i = 0; i < key.length; i++) {
    const c = key[i]
    if (c === '.') {
      if (buf) {
        parts.push(buf)
        buf = ''
      }
    } else if (c === '[') {
      if (buf) {
        parts.push(buf)
        buf = ''
      }
      const end = key.indexOf(']', i)
      if (end < 0) throw new Error(`Invalid key (unclosed [): ${key}`)
      const idx = Number(key.slice(i + 1, end))
      if (Number.isNaN(idx)) throw new Error(`Invalid array index in key: ${key}`)
      parts.push(idx)
      i = end
    } else {
      buf += c
    }
  }
  if (buf) parts.push(buf)
  return parts
}

export function collectStringLeaves(obj, basePath = []) {
  if (obj === null || obj === undefined) return []
  if (typeof obj === 'string') return [{ path: basePath, value: obj }]
  if (Array.isArray(obj)) {
    return obj.flatMap((item, idx) => collectStringLeaves(item, [...basePath, idx]))
  }
  if (typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) =>
      collectStringLeaves(v, [...basePath, k]),
    )
  }
  return []
}

export function chunkLeaves(leaves, chunkSize) {
  const chunks = []
  for (let i = 0; i < leaves.length; i += chunkSize) {
    chunks.push(leaves.slice(i, i + chunkSize))
  }
  return chunks
}

export function buildEmptyTemplate(obj) {
  if (obj === null || obj === undefined) return obj
  if (typeof obj === 'string') return ''
  if (typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map((it) => buildEmptyTemplate(it))
  const out = {}
  for (const [k, v] of Object.entries(obj)) out[k] = buildEmptyTemplate(v)
  return out
}

export function pathToKey(path) {
  return path.map((p) => (typeof p === 'number' ? `[${p}]` : p)).join('.')
}

export function leavesToPayload(chunk) {
  const out = {}
  for (const leaf of chunk) out[pathToKey(leaf.path)] = leaf.value
  return out
}

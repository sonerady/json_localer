// Nested JSON ağacına path → string yazımı.
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

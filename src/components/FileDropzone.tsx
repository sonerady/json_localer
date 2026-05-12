import { useCallback, useState, type DragEvent } from 'react'
import { Upload, FileJson, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FileDropzoneProps {
  fileName: string | null
  sizeBytes: number | null
  stringCount: number | null
  onFileLoad: (name: string, parsed: unknown, sizeBytes: number) => void
  onClear: () => void
  disabled?: boolean
}

export function FileDropzone({
  fileName,
  sizeBytes,
  stringCount,
  onFileLoad,
  onClear,
  disabled,
}: FileDropzoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      setError(null)
      if (!file.name.toLowerCase().endsWith('.json')) {
        setError('Sadece .json dosyası yükle.')
        return
      }
      try {
        const text = await file.text()
        const parsed = JSON.parse(text)
        onFileLoad(file.name, parsed, file.size)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'JSON parse hatası')
      }
    },
    [onFileLoad],
  )

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragOver(false)
      if (disabled) return
      const file = e.dataTransfer.files?.[0]
      if (file) void handleFile(file)
    },
    [disabled, handleFile],
  )

  if (fileName) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-foreground/10">
            <FileJson className="h-4 w-4" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium">{fileName}</span>
            <span className="text-xs text-muted-foreground numerals">
              {sizeBytes !== null ? `${(sizeBytes / 1024).toFixed(1)} KB` : ''}
              {stringCount !== null ? ` · ${stringCount} string` : ''}
            </span>
          </div>
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={onClear}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Dosyayı kaldır"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        'relative flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-6 py-10 text-center transition-colors',
        dragOver ? 'border-foreground/60 bg-muted/40' : 'border-border',
        disabled && 'opacity-50',
      )}
    >
      <Upload className="h-5 w-5 text-muted-foreground" />
      <div className="text-sm">
        <span className="font-medium">en.json sürükle</span>
        <span className="text-muted-foreground"> veya </span>
        <label
          className={cn(
            'cursor-pointer text-foreground underline-offset-4 hover:underline',
            disabled && 'pointer-events-none',
          )}
        >
          dosya seç
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            disabled={disabled}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Yapı korunur — sadece string değerler çevrilir.
      </p>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}

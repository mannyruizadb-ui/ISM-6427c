import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { deletePhoto, signedUrls, uploadPhoto } from '../lib/photos'
import type { WorkOrderPhoto } from '../lib/types'
import { Icon } from './Icon'
import { useToast } from './ui'

/** Camera button that opens the rear camera on phones (file picker on desktop). */
export function CameraInput({ onFiles, label = 'Add photo' }: { onFiles: (files: File[]) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="photo-add" onClick={() => ref.current?.click()}>
        <Icon name="camera" />
        {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </>
  )
}

/** Local previews for photos chosen before the work order exists. */
export function PendingPhotos({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const [urls, setUrls] = useState<string[]>([])
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f))
    setUrls(u)
    return () => u.forEach((x) => URL.revokeObjectURL(x))
  }, [files])
  return (
    <div className="photos">
      {urls.map((u, i) => (
        <div className="photo" key={u}>
          <img src={u} alt={`Photo ${i + 1}`} />
          <button type="button" className="x" aria-label="Remove photo" onClick={() => onChange(files.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <CameraInput onFiles={(f) => onChange([...files, ...f])} />
    </div>
  )
}

/** Photos attached to a saved work order, live-updating. */
export function WorkOrderPhotos({ workOrderId, canDelete }: { workOrderId: string; canDelete: (p: WorkOrderPhoto) => boolean }) {
  const [photos, setPhotos] = useState<WorkOrderPhoto[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const toast = useToast()

  useEffect(() => {
    let alive = true
    const load = async () => {
      const { data } = await supabase
        .from('work_order_photos')
        .select('*')
        .eq('work_order_id', workOrderId)
        .order('created_at')
      if (!alive || !data) return
      setPhotos(data as WorkOrderPhoto[])
      const u = await signedUrls(data.map((p) => p.storage_path))
      if (alive) setUrls(u)
    }
    load()
    const ch = supabase
      .channel(`photos-${workOrderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'work_order_photos', filter: `work_order_id=eq.${workOrderId}` }, load)
      .subscribe()
    return () => {
      alive = false
      supabase.removeChannel(ch)
    }
  }, [workOrderId])

  const add = async (files: File[]) => {
    setBusy((b) => b + files.length)
    for (const f of files) {
      try {
        await uploadPhoto(workOrderId, f)
      } catch (e) {
        toast(`Photo upload failed: ${(e as Error).message}`, true)
      } finally {
        setBusy((b) => b - 1)
      }
    }
  }

  return (
    <>
      <div className="photos">
        {photos.map((p) => (
          <div className="photo" key={p.id}>
            {urls[p.storage_path] ? (
              <button type="button" style={{ all: 'unset', cursor: 'zoom-in', display: 'block', width: '100%', height: '100%' }} onClick={() => setOpen(urls[p.storage_path])}>
                <img src={urls[p.storage_path]} alt="Work order photo" loading="lazy" />
              </button>
            ) : null}
            {canDelete(p) && (
              <button
                type="button"
                className="x"
                aria-label="Delete photo"
                onClick={async () => {
                  if (!confirm('Delete this photo?')) return
                  try {
                    await deletePhoto(p.id, p.storage_path)
                  } catch (e) {
                    toast((e as Error).message, true)
                  }
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {Array.from({ length: busy }).map((_, i) => (
          <div className="photo" key={`busy-${i}`} aria-label="Uploading">
            <div className="spinner" style={{ margin: '35% auto' }} />
          </div>
        ))}
        <CameraInput onFiles={add} />
      </div>
      {open && (
        <div className="lightbox" onClick={() => setOpen(null)} role="dialog" aria-label="Photo">
          <img src={open} alt="Work order photo, full size" />
        </div>
      )}
    </>
  )
}

import { PHOTO_BUCKET, supabase, must } from './supabase'

const MAX_EDGE = 1600

/** Shrink phone photos (often 4–8 MB) to a ~300 KB JPEG before upload. */
export async function compress(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    return blob ?? file
  } catch {
    return file // browser can't decode (e.g. HEIC on some devices) — upload as-is
  }
}

export async function uploadPhoto(workOrderId: string, file: File): Promise<void> {
  const blob = await compress(file)
  const ext = blob.type === 'image/jpeg' ? 'jpg' : (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${workOrderId}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, {
    contentType: blob.type || file.type || 'image/jpeg',
    upsert: false,
  })
  if (up.error) throw new Error(up.error.message)
  const res = await supabase.from('work_order_photos').insert({ work_order_id: workOrderId, storage_path: path })
  if (res.error) {
    await supabase.storage.from(PHOTO_BUCKET).remove([path])
    throw new Error(res.error.message)
  }
}

export async function deletePhoto(id: string, path: string): Promise<void> {
  must(await supabase.from('work_order_photos').delete().eq('id', id))
  await supabase.storage.from(PHOTO_BUCKET).remove([path])
}

export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data, error } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60 * 60)
  if (error || !data) return {}
  const out: Record<string, string> = {}
  for (const d of data) if (d.signedUrl && d.path) out[d.path] = d.signedUrl
  return out
}

export const RECEIPT_BUCKET = 'fuel-receipts'

/** Path a receipt will be stored at; saved on the fill-up before the upload. */
export function receiptPath(fuelLogId: string): string {
  return `${fuelLogId}/${crypto.randomUUID()}.jpg`
}

export async function uploadReceipt(path: string, file: File): Promise<void> {
  const blob = await compress(file)
  const { error } = await supabase.storage.from(RECEIPT_BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false,
  })
  if (error) throw new Error(error.message)
}

export async function receiptUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(RECEIPT_BUCKET).createSignedUrl(path, 60 * 60)
  return data?.signedUrl ?? null
}

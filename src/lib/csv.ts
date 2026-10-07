import Papa from 'papaparse'

export interface CsvField {
  key: string
  label: string
  required?: boolean
  aliases: string[]
  hint?: string
}

export type ImportKind = 'assets' | 'parts' | 'repairs' | 'fuel'

export const FIELDS: Record<ImportKind, CsvField[]> = {
  assets: [
    { key: 'kind', label: 'Type (truck / equipment)', aliases: ['kind', 'type', 'asset type', 'category'], hint: 'Blank = truck if a unit number is given' },
    { key: 'unit_number', label: 'Unit number (trucks)', aliases: ['unit', 'unit number', 'unit #', 'unit no', 'truck', 'truck #', 'truck number'] },
    { key: 'name', label: 'Name (equipment)', aliases: ['name', 'machine', 'equipment', 'equipment name', 'asset'] },
    { key: 'equipment_type', label: 'Equipment type', aliases: ['equipment type', 'machine type', 'subtype'], hint: 'washer, dryer, ironer, folder, other' },
    { key: 'year', label: 'Year', aliases: ['year', 'yr', 'model year'] },
    { key: 'make', label: 'Make', aliases: ['make', 'manufacturer', 'brand'] },
    { key: 'model', label: 'Model', aliases: ['model'] },
    { key: 'vin', label: 'VIN', aliases: ['vin', 'vin #', 'vin number'] },
    { key: 'serial_number', label: 'Serial number', aliases: ['serial', 'serial number', 'serial #', 'sn', 's/n'] },
    { key: 'current_mileage', label: 'Current mileage', aliases: ['mileage', 'miles', 'odometer', 'current mileage'] },
    { key: 'status', label: 'Status', aliases: ['status'], hint: 'in service / down' },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments'] },
  ],
  parts: [
    { key: 'part_number', label: 'Part number', required: true, aliases: ['part number', 'part #', 'part no', 'part', 'pn', 'sku', 'item #'] },
    { key: 'description', label: 'Description', required: true, aliases: ['description', 'desc', 'item', 'name', 'part name'] },
    { key: 'vendor', label: 'Vendor', aliases: ['vendor', 'supplier', 'source'], hint: 'New vendor names are created' },
    { key: 'unit_cost', label: 'Unit cost', aliases: ['unit cost', 'cost', 'price', 'unit price', 'each'] },
    { key: 'qty_on_hand', label: 'Quantity on hand', aliases: ['qty', 'quantity', 'on hand', 'qty on hand', 'stock', 'count'] },
    { key: 'reorder_point', label: 'Reorder point', aliases: ['reorder', 'reorder point', 'min', 'minimum', 'reorder at'] },
    { key: 'location', label: 'Bin / location', aliases: ['location', 'bin', 'shelf'] },
    { key: 'fits', label: 'Fits (units / machines)', aliases: ['fits', 'fits assets', 'used on', 'applies to'], hint: 'Separate with ; or ,' },
  ],
  repairs: [
    { key: 'asset', label: 'Asset (unit # or name)', required: true, aliases: ['asset', 'unit', 'unit #', 'unit number', 'truck', 'machine', 'equipment'] },
    { key: 'date', label: 'Date', required: true, aliases: ['date', 'repair date', 'date opened', 'opened', 'service date'] },
    { key: 'problem', label: 'Problem', required: true, aliases: ['problem', 'issue', 'complaint', 'description', 'reason'] },
    { key: 'fix', label: 'Fix / work done', aliases: ['fix', 'repair', 'work done', 'resolution', 'action', 'work performed'] },
    { key: 'labor_hours', label: 'Labor hours', aliases: ['labor hours', 'hours', 'labor hrs', 'hrs'] },
    { key: 'labor_rate', label: 'Labor rate', aliases: ['labor rate', 'rate', 'hourly rate'] },
    { key: 'parts_cost', label: 'Parts cost', aliases: ['parts cost', 'parts', 'parts $', 'material', 'materials'] },
    { key: 'vendor_cost', label: 'Outside vendor cost', aliases: ['vendor cost', 'outside cost', 'outside vendor', 'shop cost', 'invoice'] },
    { key: 'downtime_hours', label: 'Downtime hours', aliases: ['downtime', 'downtime hours', 'down hours', 'hours down'] },
    { key: 'mileage', label: 'Mileage', aliases: ['mileage', 'miles', 'odometer'] },
    { key: 'status', label: 'Status', aliases: ['status'], hint: 'Blank = done' },
    { key: 'reported_by', label: 'Reported by', aliases: ['reported by', 'reporter', 'driver'] },
    { key: 'mechanic', label: 'Mechanic / vendor', aliases: ['mechanic', 'tech', 'technician', 'assigned', 'assigned to', 'done by', 'vendor'] },
  ],
  fuel: [
    { key: 'vehicle', label: 'Truck / vehicle', required: true, aliases: ['truck', 'truck #', 'truck number', 'unit', 'unit #', 'vehicle'], hint: 'Names that aren’t trucks in the app are logged as rentals / other' },
    { key: 'date', label: 'Date', required: true, aliases: ['date', 'date of fueling', 'fill date', 'fueling date'] },
    { key: 'odometer', label: 'Odometer at fill-up', aliases: ['odometer', 'odo', 'mileage', 'miles', 'starting odometer reading', 'starting odometer', 'odometer reading'], hint: 'The reading when you filled up (in the old gas tracker: "Starting Odometer Reading")' },
    { key: 'gallons', label: 'Gallons', required: true, aliases: ['gallons', 'gal', 'total gallons purchased', 'gallons purchased', 'qty'] },
    { key: 'total_cost', label: 'Total price', required: true, aliases: ['total price', 'price', 'total', 'cost', 'amount', 'total cost'] },
    { key: 'location', label: 'Station / location', aliases: ['location', 'fueling location', 'station', 'gas station'] },
    { key: 'full_tank', label: 'Full tank? (Y/N)', aliases: ['full', 'full tank', 'filled'], hint: 'Blank = yes' },
    { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comments'] },
  ],
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim()

/** Guess which CSV column feeds each field. */
export function autoMap(kind: ImportKind, headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  const used = new Set<string>()
  for (const f of FIELDS[kind]) {
    const candidates = [f.key.replace(/_/g, ' '), ...f.aliases].map(norm)
    const h = headers.find((x) => !used.has(x) && candidates.includes(norm(x)))
    if (h) {
      map[f.key] = h
      used.add(h)
    }
  }
  return map
}

export function parseCsv(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (r) => {
        const headers = (r.meta.fields ?? []).filter(Boolean)
        resolve({ headers, rows: r.data })
      },
      error: reject,
    })
  })
}

export function templateCsv(kind: ImportKind): string {
  return Papa.unparse({ fields: FIELDS[kind].map((f) => f.key), data: [] })
}

export function downloadText(name: string, text: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Accepts 2024-03-05, 3/5/2024, 3/5/24, 3-5-2024 and Excel serial numbers. */
export function parseDateLoose(v: string): string | null {
  const s = v.trim()
  if (!s) return null
  let y: number, m: number, d: number
  let match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) {
    ;[y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  } else if ((match = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) {
    ;[m, d, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
    if (y < 100) y += y >= 70 ? 1900 : 2000
  } else if (/^\d{5}(\.\d+)?$/.test(s)) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86_400_000)
    ;[y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()]
  } else {
    const dt = new Date(s)
    if (Number.isNaN(dt.getTime())) return null
    ;[y, m, d] = [dt.getFullYear(), dt.getMonth() + 1, dt.getDate()]
  }
  const check = new Date(y, m - 1, d)
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

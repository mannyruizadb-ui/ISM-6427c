export type Role = 'admin' | 'mechanic' | 'driver' | 'pending'

export interface Profile {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  role: Role
  active: boolean
  created_at: string
}

export interface Settings {
  id: number
  company_name: string | null
  default_labor_rate: number | null
  setup_dismissed: boolean
}

export type AssetKind = 'truck' | 'equipment'
export type EquipmentType = 'washer' | 'dryer' | 'ironer' | 'folder' | 'other'
export const EQUIPMENT_TYPES: EquipmentType[] = ['washer', 'dryer', 'ironer', 'folder', 'other']

export interface Asset {
  id: string
  kind: AssetKind
  unit_number: string | null
  name: string | null
  label: string
  equipment_type: EquipmentType | null
  year: number | null
  make: string | null
  model: string | null
  vin: string | null
  serial_number: string | null
  current_mileage: number | null
  status: 'in_service' | 'down'
  notes: string | null
  retired_at: string | null
  created_at: string
}

export interface AssetFinancials {
  asset_id: string
  purchase_date: string | null
  purchase_price: number | null
  replacement_cost: number | null
}

export interface Vendor {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  notes: string | null
  retired_at: string | null
  created_at: string
}

export interface Part {
  id: string
  part_number: string
  description: string
  vendor_id: string | null
  unit_cost: number
  qty_on_hand: number
  reorder_point: number
  location: string | null
  retired_at: string | null
  created_at: string
}

export interface PartFit {
  part_id: string
  asset_id: string
}

export interface PmSchedule {
  id: string
  asset_id: string
  task: string
  interval_miles: number | null
  interval_days: number | null
  last_done_miles: number | null
  last_done_on: string | null
  notes: string | null
  active: boolean
  created_at: string
}

export type WoStatus = 'open' | 'waiting_parts' | 'done'
export const WO_STATUSES: WoStatus[] = ['open', 'waiting_parts', 'done']

export interface WorkOrder {
  id: string
  number: number
  asset_id: string
  opened_on: string
  reported_by: string | null
  reported_by_name: string | null
  assigned_to: string | null
  vendor_id: string | null
  assigned_name: string | null
  problem: string
  fix: string | null
  labor_hours: number
  downtime_hours: number
  mileage: number | null
  out_of_service: boolean
  status: WoStatus
  pm_schedule_id: string | null
  source: 'app' | 'driver' | 'import'
  closed_at: string | null
  created_at: string
  updated_at: string
}

export interface WorkOrderCost {
  work_order_id: string
  labor_rate: number
  vendor_cost: number
  other_parts_cost: number
}

export interface WorkOrderPart {
  id: string
  work_order_id: string
  part_id: string
  quantity: number
  unit_cost: number | null
  created_by: string | null
  created_at: string
}

export interface WorkOrderPhoto {
  id: string
  work_order_id: string
  storage_path: string
  uploaded_by: string | null
  created_at: string
}

export interface WorkOrderTotal {
  id: string
  number: number
  asset_id: string
  opened_on: string
  status: WoStatus
  labor_hours: number
  downtime_hours: number
  labor_cost: number
  parts_cost: number
  vendor_cost: number
  total_cost: number
}

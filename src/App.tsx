import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth, useRole } from './state/auth'
import { DataProvider, useData } from './state/data'
import { ThemeProvider } from './state/theme'
import { isConfigured } from './lib/supabase'
import { Layout } from './components/Layout'
import { Spinner, ToastProvider } from './components/ui'
import { Login } from './pages/Login'
import { Pending } from './pages/Pending'
import { Dashboard } from './pages/Dashboard'
import { WorkOrders } from './pages/WorkOrders'
import { WorkOrderNew } from './pages/WorkOrderNew'
import { WorkOrderDetail } from './pages/WorkOrderDetail'
import { DriverReport } from './pages/DriverReport'
import { Assets } from './pages/Assets'
import { AssetDetail } from './pages/AssetDetail'
import { Parts } from './pages/Parts'
import { Reorder } from './pages/Reorder'
import { Maintenance } from './pages/Maintenance'
import { Reports } from './pages/Reports'
import { People } from './pages/People'
import { Vendors } from './pages/Vendors'
import { Import } from './pages/Import'
import { Settings } from './pages/Settings'
import { More } from './pages/More'

function NotConfigured() {
  return (
    <div className="auth-wrap">
      <div className="auth-card card stack">
        <h2>Almost there</h2>
        <p>
          This app needs two environment variables: <code>VITE_SUPABASE_URL</code> and{' '}
          <code>VITE_SUPABASE_ANON_KEY</code>. Add them in Netlify under Site configuration → Environment variables,
          then redeploy.
        </p>
      </div>
    </div>
  )
}

function Guard({ allow, children }: { allow: 'staff' | 'admin' | 'driver'; children: ReactNode }) {
  const { isAdmin, isStaff, isDriver } = useRole()
  const ok = allow === 'admin' ? isAdmin : allow === 'staff' ? isStaff : isDriver
  return ok ? <>{children}</> : <Navigate to="/" replace />
}

function Shell() {
  const { session, role, loading } = useAuth()
  const data = useData()
  if (loading) return <Spinner />
  if (!session) return <Login />
  if (!role || role === 'pending') return <Pending />
  if (data.loading) return <Spinner />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="report" element={<Guard allow="driver"><DriverReport /></Guard>} />
        <Route path="work-orders" element={<WorkOrders />} />
        <Route path="work-orders/new" element={<Guard allow="staff"><WorkOrderNew /></Guard>} />
        <Route path="work-orders/:id" element={<WorkOrderDetail />} />
        <Route path="assets" element={<Guard allow="staff"><Assets /></Guard>} />
        <Route path="assets/:id" element={<Guard allow="staff"><AssetDetail /></Guard>} />
        <Route path="parts" element={<Guard allow="staff"><Parts /></Guard>} />
        <Route path="parts/reorder" element={<Guard allow="staff"><Reorder /></Guard>} />
        <Route path="maintenance" element={<Guard allow="staff"><Maintenance /></Guard>} />
        <Route path="reports" element={<Guard allow="admin"><Reports /></Guard>} />
        <Route path="admin/people" element={<Guard allow="admin"><People /></Guard>} />
        <Route path="admin/vendors" element={<Guard allow="admin"><Vendors /></Guard>} />
        <Route path="admin/import" element={<Guard allow="admin"><Import /></Guard>} />
        <Route path="settings" element={<Settings />} />
        <Route path="more" element={<More />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  if (!isConfigured) return <NotConfigured />
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <DataProvider>
              <Shell />
            </DataProvider>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  )
}

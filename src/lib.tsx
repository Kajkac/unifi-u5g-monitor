import { useEffect, useState } from 'react'

export type TabId = 'overview' | 'signal' | 'data' | 'sms' | 'automations' | 'timeline' | 'system' | 'diagnostics' | 'mqtt' | 'settings'

export type Status = {
  checkedAt: string
  connected: boolean
  connectionError?: string
  connection: { gatewayHost: string; modemHost: string; mode: string; latencyMs?: number }
  device?: { model?: string; modelDisplay?: string; hostname?: string; version?: string; firmwareVersion?: string; serial?: string; mac?: string; architecture?: string; kernelVersion?: string; uptime?: number; uptimeText?: string; cpuPercent?: number; memoryPercent?: number; emmcWearLevel?: number; ip?: string; ipv6?: string[]; bootId?: string; bootReason?: string; dualBoot?: unknown; everCrash?: boolean; boardRevision?: string; bomRevision?: string; bootromVersion?: string; requiredVersion?: string; manufacturerId?: string; systemId?: string; hardwareCapabilities?: unknown; firmwareCapabilities?: unknown }
  radio?: { rat?: string; mode?: string; operator?: string; mcc?: number; mnc?: number; roaming?: boolean; coverage?: boolean; signalBars?: number; signalPercent?: number; band?: string; channel?: number; cellId?: number; pci?: number; lte?: SignalSet; nr?: SignalSet; lteCa?: Carrier[]; nrCa?: Carrier[]; maxDownBps?: number; maxUpBps?: number; registrationState?: string; saMode?: unknown; rxChannel?: number; txChannel?: number; currentSlot?: number; ratCapabilities?: unknown[]; supportedLteBands?: unknown[]; supportedNrBands?: unknown[]; homePlmnServing?: boolean; homePlmnDenied?: boolean }
  sim?: { active?: boolean; slot?: number; esim?: boolean; present?: boolean; state?: string; pinVerified?: boolean; pinTriesRemaining?: number; pukTriesRemaining?: number; carrier?: string; iccidMasked?: string; imeiMasked?: string; eidMasked?: string; apn?: string; rxBytes?: number; txBytes?: number; dataLimited?: boolean; dataWarning?: boolean; slots?: Array<Record<string, unknown>>; esimProfiles?: unknown[]; networkScan?: Record<string, unknown> }
  wan?: { ipv4?: string; gateway?: string; netmask?: string; dns?: string[]; mtu?: number; publicIp?: string; isp?: string; asn?: number; city?: string; country?: string; ipv6?: Record<string, unknown>; connectionInfo?: Record<string, unknown> }
  ethernet?: { speedMbps?: number; fullDuplex?: boolean; up?: boolean; rxBytes?: number; txBytes?: number; rxPackets?: number; txPackets?: number; rxErrors?: number; txErrors?: number; rxDropped?: number; txDropped?: number; rxMulticast?: number }
  system?: { load1?: number; load5?: number; load15?: number; memoryTotal?: number; memoryUsed?: number; memoryBuffer?: number; state?: string; modemState?: Record<string, unknown>; lastConnectionErrors?: unknown; rebootDuration?: number; upgradeDuration?: number }
  management?: { gatewayIp?: string; informUrl?: string; informInterval?: number; configVersion?: string; savedConfigVersion?: string; effectiveConfigVersion?: string; isolated?: boolean; locating?: boolean; lldp?: unknown; sshSessions?: unknown; adoptionState?: string; fingerprint?: string }
  sms?: { inbox: number; unread: number; outbox: number; failed: number }
}

export type SignalSet = { rsrp?: number; rsrq?: number; rssi?: number; snr?: number }
export type Carrier = { band?: number; primary?: boolean; dl_bw_mhz?: number; ul_bw_mhz?: number; dl_earfcn?: number; ul_earfcn?: number; dl_arfcn?: number; ul_arfcn?: number }
export type TrendPoint = { ts: string; connected: boolean; lteRsrp?: number; lteRsrq?: number; lteSnr?: number; nrRsrp?: number; nrRsrq?: number; nrSnr?: number; signalPercent?: number; rxBytes?: number; txBytes?: number; cellId?: string; pci?: string; band?: string }
export type EventRow = { id?: number; ts: string; level: 'info' | 'warn' | 'error' | 'action'; kind: string; message: string; data?: unknown }
export type AuthState = { enabled: boolean; authenticated: boolean; role: 'admin' | 'viewer' | null; seededDefault: boolean }

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  if (response.status === 401) window.dispatchEvent(new Event('u5g-auth-required'))
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body as T
}

export function formatBytes(value?: number) {
  if (value == null || !Number.isFinite(value)) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let next = value
  let unit = 0
  while (next >= 1000 && unit < units.length - 1) { next /= 1000; unit += 1 }
  return `${next >= 100 || unit === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[unit]}`
}

export function formatRate(value?: number) {
  if (value == null) return '—'
  return `${(value / 1_000_000).toFixed(value >= 100_000_000 ? 0 : 1)} Mbit/s`
}

export function formatRelative(value?: string, now = Date.now()) {
  if (!value) return 'never'
  const seconds = Math.max(0, Math.round((now - Date.parse(value)) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return new Date(value).toLocaleString()
}

export function useNow(interval = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), interval); return () => clearInterval(timer) }, [interval])
  return now
}

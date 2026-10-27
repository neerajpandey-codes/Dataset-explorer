import { ChangeEvent, DragEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { Activity, BarChart3, CalendarDays, Check, ChevronDown, CircleAlert, CloudUpload, Copy, Database, FileUp, Filter, LayoutDashboard, Link2, Palette, Pause, Play, Search, Table2, Upload, X } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getDashboardRecord, saveDashboardRecord, supabaseConfigured } from './supabase'
import DataQuality from './DataQuality'

type Row = Record<string, string>
type ColumnKind = 'Numeric' | 'Date' | 'Categorical'
type ColumnAnalysis = { name: string; kind: ColumnKind; missing: number }
type Dataset = {
  name: string
  headers: string[]
  rows: Row[]
  columns: ColumnAnalysis[]
  stats: { totalRows: number; totalColumns: number; missingValues: number; types: Record<ColumnKind, number> }
  warnings: string[]
}
type ChartPoint = { label: string; value: number }
type Theme = 'light' | 'dark' | 'spider'
type DataChart = {
  id: string
  title: string
  subtitle: string
  kind: 'bar' | 'line' | 'pie'
  data: ChartPoint[]
  xLabel: string
  yLabel: string
  color: string
}
const colors = ['#ff4655', '#4b9fff', '#8fc7ff', '#c191ff', '#ff9f6e', '#63cbd1', '#a9b7ff']
const readTheme = (): Theme => {
  try { const saved = localStorage.getItem('datascope-theme'); return saved === 'light' || saved === 'dark' || saved === 'spider' ? saved : 'spider' } catch { return 'spider' }
}
const readAnimation = () => {
  try { return localStorage.getItem('datascope-spider-animation') !== 'off' } catch { return true }
}

function numericValue(value: string | undefined): number | null {
  if (!value?.trim()) return null
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function dateKey(value: string | undefined): string | null {
  if (!value?.trim()) return null
  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) {
    const [, year, month, day] = iso
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day)) return null
    return date.toISOString().slice(0, 10)
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null
}

function topCategories(counts: Map<string, number>, limit = 7): ChartPoint[] {
  const sorted = [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  if (sorted.length <= limit) return sorted
  const top = sorted.slice(0, limit)
  top.push({ label: 'Other categories', value: sorted.slice(limit).reduce((sum, entry) => sum + entry.value, 0) })
  return top
}

function classify(values: string[]): ColumnKind {
  const nonempty = values.map((v) => v.trim()).filter(Boolean)
  if (!nonempty.length) return 'Categorical'
  const numeric = nonempty.filter((v) => Number.isFinite(Number(v.replace(/,/g, '')))).length
  if (numeric / nonempty.length >= 0.85) return 'Numeric'
  const dateLike = nonempty.filter((v) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v) || /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(v)).length
  return dateLike / nonempty.length >= 0.7 ? 'Date' : 'Categorical'
}

function analyzeDataset(name: string, headers: string[], rows: Row[], warnings: string[] = []): Dataset {
  const columns = headers.map((columnName) => {
    const values = rows.map((row) => row[columnName] ?? '')
    return { name: columnName, kind: classify(values), missing: values.filter((value) => !value.trim()).length }
  })
  const types: Record<ColumnKind, number> = { Numeric: 0, Categorical: 0, Date: 0 }
  columns.forEach((column) => { types[column.kind] += 1 })
  return {
    name, headers, rows, columns, warnings,
    stats: {
      totalRows: rows.length,
      totalColumns: headers.length,
      missingValues: columns.reduce((total, column) => total + column.missing, 0),
      types,
    },
  }
}

function restoreDataset(value: unknown, fallbackName: string): Dataset | null {
  if (!value || typeof value !== 'object') return null
  const saved = value as { name?: unknown; headers?: unknown; rows?: unknown; warnings?: unknown }
  if (!Array.isArray(saved.headers) || !Array.isArray(saved.rows) || saved.headers.length < 1 || saved.headers.length > 100 || saved.rows.length < 1 || saved.rows.length > 10000) return null
  if (!saved.headers.every((header): header is string => typeof header === 'string' && Boolean(header.trim()))) return null
  const headers = saved.headers as string[]
  if (new Set(headers).size !== headers.length) return null
  const rows: Row[] = []
  for (const savedRow of saved.rows) {
    if (!savedRow || typeof savedRow !== 'object' || Array.isArray(savedRow)) return null
    const row = savedRow as Record<string, unknown>
    if (!headers.every((header) => typeof row[header] === 'string')) return null
    rows.push(Object.fromEntries(headers.map((header) => [header, (row[header] as string).trim()])))
  }
  const warnings = Array.isArray(saved.warnings) ? saved.warnings.filter((warning): warning is string => typeof warning === 'string').slice(0, 20) : []
  const name = typeof saved.name === 'string' && saved.name.trim() ? saved.name.slice(0, 180) : fallbackName
  return analyzeDataset(name, headers, rows, warnings)
}

function CinematicBackdrop() {
  return <div className="cinematic-backdrop" aria-hidden="true">
    <svg className="night-scene" viewBox="0 0 1120 760" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="city-far" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#152642" /><stop offset="1" stopColor="#09111f" /></linearGradient>
        <linearGradient id="hero-suit" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f84858" /><stop offset=".48" stopColor="#9f203c" /><stop offset="1" stopColor="#173b72" /></linearGradient>
        <linearGradient id="hero-blue" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#58b5ff" /><stop offset="1" stopColor="#184b91" /></linearGradient>
        <radialGradient id="scene-glow"><stop stopColor="#3178c9" stopOpacity=".24" /><stop offset="1" stopColor="#08101e" stopOpacity="0" /></radialGradient>
        <filter id="soft-glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="7" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>

      <ellipse cx="850" cy="260" rx="400" ry="330" fill="url(#scene-glow)" />

      <g className="scene-web" fill="none" stroke="#6db7ff" strokeWidth="1.2">
        <path d="M1120 0 C1000 110 925 226 890 380 M1120 0 C1055 168 1025 297 1017 440 M1120 0 C930 76 790 171 690 299 M1120 0 C970 15 835 26 710 76" />
        <path d="M1072 44 Q1007 19 947 17 M1025 94 Q931 55 860 49 M978 148 Q878 99 801 95 M939 202 Q843 154 763 147 M909 257 Q821 212 740 201 M891 313 Q809 274 724 257" />
      </g>

      <path className="city-far" d="M0 610 L0 526 58 526 58 486 108 486 108 544 157 544 157 461 197 461 197 506 249 506 249 430 292 430 292 544 335 544 335 478 386 478 386 527 427 527 427 448 468 448 468 560 515 560 515 496 562 496 562 538 605 538 605 456 653 456 653 511 698 511 698 426 744 426 744 545 789 545 789 478 834 478 834 530 882 530 882 443 929 443 929 512 979 512 979 467 1031 467 1031 533 1080 533 1080 488 1120 488 1120 760 0 760 Z" fill="url(#city-far)" opacity=".8" />
      <path className="city-near" d="M0 660 L0 590 71 590 71 550 128 550 128 625 177 625 177 568 241 568 241 637 294 637 294 522 358 522 358 611 414 611 414 574 478 574 478 664 542 664 542 549 600 549 600 632 662 632 662 570 730 570 730 654 795 654 795 522 860 522 860 626 920 626 920 558 991 558 991 640 1052 640 1052 578 1120 578 1120 760 0 760 Z" fill="#07101d" opacity=".88" />
      <g className="city-lights">
        <path d="M88 567h4v16h-4zm23 0h4v16h-4zm112 20h4v18h-4zm18 0h4v18h-4zm119-42h4v20h-4zm19 0h4v20h-4zm64 54h4v18h-4zm22 0h4v18h-4zm145-30h4v20h-4zm20 0h4v20h-4zm101 38h4v19h-4zm23 0h4v19h-4zm106-55h4v22h-4zm21 0h4v22h-4zm104 63h4v17h-4z" fill="#59aaff" opacity=".62" />
        <path d="M313 565h4v15h-4zm21 0h4v15h-4zm277 22h4v17h-4zm22 0h4v17h-4zm231-36h4v18h-4zm22 0h4v18h-4zm106 26h4v16h-4z" fill="#f34b5d" opacity=".58" />
      </g>
      <path d="M0 704H1120" stroke="#3e8de0" strokeOpacity=".18" />

      <g className="motion-trails" fill="none" strokeLinecap="round" filter="url(#soft-glow)">
        <path className="trail trail-red" d="M557 247 Q635 202 688 171" stroke="#ff5362" strokeWidth="3" />
        <path className="trail trail-blue" d="M574 274 Q645 235 701 214" stroke="#55adff" strokeWidth="2" />
        <path className="trail trail-white" d="M604 294 Q657 271 708 256" stroke="#c5e5ff" strokeWidth="1.4" />
      </g>

      <g className="swing-rig" transform-origin="1046 30">
        <path d="M1046 30 L807 280" fill="none" stroke="#d5eaff" strokeWidth="2" strokeOpacity=".9" />
        <path d="M1046 30 L807 280" fill="none" stroke="#58aaff" strokeWidth="6" strokeOpacity=".18" filter="url(#soft-glow)" />
        <path d="M988 91l-8-8m-18 35-9-8m-18 37-10-7m-18 36-10-7m-17 36-11-7m-17 35-11-7" stroke="#b9dcff" strokeWidth="1" strokeOpacity=".6" />

        <g transform="translate(770 300)">
          <g className="hero-figure" filter="url(#soft-glow)">
            {/* Original masked city-swinger silhouette, without logos or insignia. */}
            <path d="M-24-60 Q-20-82 0-86 Q22-81 25-58 L19-34 Q1-22-19-35Z" fill="url(#hero-suit)" stroke="#ff7882" strokeWidth="2" />
            <path d="M-16-57 Q-5-65 0-62 Q-8-51-16-49Z M7-62 Q17-62 21-54 Q12-48 4-51Z" fill="#d9f0ff" stroke="#78bfff" strokeWidth="1.5" />
            <path d="M-20-32 Q-7-42 13-32 L27 4 L13 34 L-17 29 L-28-3Z" fill="url(#hero-suit)" stroke="#ff6471" strokeWidth="2" />
            <path d="M-8-29L4-20 15-29 20-1 4 16-15 1Z" fill="#f16470" opacity=".74" />
            <path d="M-19-23 Q-41-25-53-7 L-69 12" fill="none" stroke="url(#hero-blue)" strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M-69 12l-9 8" fill="none" stroke="#f14c5c" strokeWidth="9" strokeLinecap="round" />
            <path d="M14-25 Q31-34 38-44 L40-61" fill="none" stroke="url(#hero-suit)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M40-61l1-9" fill="none" stroke="#f5f8ff" strokeWidth="7" strokeLinecap="round" />
            <path d="M-14 27 Q-22 44-39 53 L-53 44" fill="none" stroke="url(#hero-blue)" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8 30 Q21 47 15 64 L0 77" fill="none" stroke="url(#hero-suit)" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M-53 44l-11-5m64 38-9 8" stroke="#d5eaff" strokeWidth="5" strokeLinecap="round" />
          </g>
        </g>
      </g>
    </svg>
  </div>
}

function App() {
  const inputRef = useRef<HTMLInputElement>(null)
  const uploadVersion = useRef(0)
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyMessage, setBusyMessage] = useState('Reading your dataset…')
  const [saving, setSaving] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [dashboardId, setDashboardId] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState('')
  const [shareMessage, setShareMessage] = useState('')
  const [query, setQuery] = useState('')
  const [filterColumn, setFilterColumn] = useState('')
  const [filterValue, setFilterValue] = useState('')
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [spiderAnimation, setSpiderAnimation] = useState(readAnimation)

  useEffect(() => {
    try { localStorage.setItem('datascope-theme', theme) } catch { /* Keep theme usable when storage is unavailable. */ }
  }, [theme])
  useEffect(() => {
    try { localStorage.setItem('datascope-spider-animation', spiderAnimation ? 'on' : 'off') } catch { /* Optional preference only. */ }
  }, [spiderAnimation])

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('dashboard')
    if (!id) return
    const version = uploadVersion.current
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      setError('This dashboard link is invalid.')
      return
    }
    if (!supabaseConfigured) {
      setError('This shared dashboard needs Supabase configuration. Local CSV analysis is still available.')
      return
    }
    let active = true
    setBusy(true)
    setBusyMessage('Loading the saved dashboard…')
    getDashboardRecord(id).then((record) => {
      if (!active || version !== uploadVersion.current) return
      if (!record) throw new Error('No saved dashboard was found for this link.')
      const restored = restoreDataset(record.dataset, record.title)
      if (!restored) throw new Error('The saved dashboard data is invalid or exceeds the supported limits.')
      setDataset(restored)
      setDashboardId(record.id)
      setShareUrl(window.location.href)
      setShareMessage('Saved dashboard loaded from Supabase.')
    }).catch((loadError: unknown) => {
      if (!active || version !== uploadVersion.current) return
      setDataset(null)
      setError(loadError instanceof Error ? loadError.message : 'Could not load this shared dashboard.')
    }).finally(() => {
      if (active && version === uploadVersion.current) setBusy(false)
    })
    return () => { active = false }
  }, [])

  const loadFile = (file?: File) => {
    if (!file) return
    const version = ++uploadVersion.current
    setError(''); setQuery(''); setFilterColumn(''); setFilterValue('')
    setDashboardId(null); setShareUrl(''); setShareMessage('')
    const localUrl = new URL(window.location.href)
    localUrl.searchParams.delete('dashboard')
    window.history.replaceState(window.history.state, '', localUrl)
    setDataset(null)
    setBusy(false)
    if (!/\.csv$/i.test(file.name) && !['text/csv', 'application/vnd.ms-excel', 'text/plain'].includes(file.type)) {
      setError('Please choose a CSV file.'); return
    }
    setBusy(true)
    setBusyMessage('Analyzing your CSV…')
    try {
      Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: 'greedy', transformHeader: (h, i) => h.trim() || `Column ${i + 1}`,
      complete: (result) => {
        if (version !== uploadVersion.current) return
        setBusy(false)
        const headers = result.meta.fields?.filter(Boolean) ?? []
        if (!headers.length) { setError('This file has no column headers. Add a header row and try again.'); return }
        const rows = result.data.map((row) => Object.fromEntries(headers.map((h) => [h, String(row[h] ?? '').trim()])))
        if (!rows.length) { setError('No data rows found. Check that the CSV includes rows below its header.'); return }
        const warnings: string[] = []
        const unevenRows = result.errors.filter((parseError) => parseError.code === 'TooFewFields' || parseError.code === 'TooManyFields').length
        const recoveredErrors = result.errors.length - unevenRows
        if (unevenRows) warnings.push(`${unevenRows} row${unevenRows === 1 ? '' : 's'} had a different number of fields. Extra fields were skipped and missing cells are blank.`)
        if (recoveredErrors) warnings.push(`Papa Parse recovered from ${recoveredErrors} formatting issue${recoveredErrors === 1 ? '' : 's'}. Review the preview for affected values.`)
        setDataset(analyzeDataset(file.name, headers, rows, warnings))
      },
      error: (parseError) => {
        if (version !== uploadVersion.current) return
        setBusy(false)
        setError(parseError.message || 'Unable to parse this CSV.')
      },
      })
    } catch (parseError) {
      if (version !== uploadVersion.current) return
      setBusy(false)
      setError(parseError instanceof Error ? parseError.message : 'Unable to parse this CSV.')
    }
  }
  const onInput = (event: ChangeEvent<HTMLInputElement>) => { loadFile(event.target.files?.[0]); event.target.value = '' }
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); loadFile(event.dataTransfer.files[0]) }
  const copyShareUrl = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareMessage('Share link copied to clipboard.')
    } catch {
      setShareMessage('Select the link below and copy it manually.')
    }
  }
  const saveOrCopyDashboard = async () => {
    if (!dataset || !supabaseConfigured) return
    if (dashboardId && shareUrl) { await copyShareUrl(); return }
    const version = uploadVersion.current
    setSaving(true)
    setShareMessage('Saving dashboard…')
    try {
      if (dataset.rows.length > 10000 || dataset.headers.length > 100) {
        throw new Error('Dashboard limit is 10,000 rows and 100 columns. This CSV still works locally.')
      }
      const payload = { name: dataset.name, headers: dataset.headers, rows: dataset.rows, warnings: dataset.warnings }
      const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).length
      if (payloadBytes > 1_500_000) throw new Error('This dataset is over the 1.5 MB sharing limit. It remains available locally.')
      const id = crypto.randomUUID()
      const metadata = {
        rows: dataset.stats.totalRows,
        columns: dataset.stats.totalColumns,
        missingValues: dataset.stats.missingValues,
        types: dataset.stats.types,
      }
      await saveDashboardRecord(id, dataset.name.slice(0, 120) || 'Dataset dashboard', payload, metadata)
      if (version !== uploadVersion.current) return
      const url = new URL(window.location.href)
      url.searchParams.set('dashboard', id)
      window.history.replaceState(window.history.state, '', url)
      setDashboardId(id)
      setShareUrl(url.toString())
      try {
        await navigator.clipboard.writeText(url.toString())
        setShareMessage('Dashboard saved. Share link copied to clipboard.')
      } catch {
        setShareMessage('Dashboard saved. Select and copy the share link below.')
      }
    } catch (saveError) {
      if (version === uploadVersion.current) setShareMessage(saveError instanceof Error ? saveError.message : 'Could not save this dashboard.')
    } finally {
      setSaving(false)
    }
  }

  const columns = dataset?.columns ?? []
  const numericColumns = useMemo(() => columns.filter((col) => col.kind === 'Numeric'), [columns])
  const categoricalColumns = useMemo(() => columns.filter((col) => col.kind === 'Categorical'), [columns])
  const dateColumn = useMemo(() => columns.find((col) => col.kind === 'Date'), [columns])
  const missingTotal = dataset?.stats.missingValues ?? 0
  const filteredRows = useMemo(() => {
    if (!dataset) return []
    const needle = query.toLowerCase()
    return dataset.rows.filter((row) => {
      const matchesSearch = !needle || dataset.headers.some((h) => (row[h] ?? '').toLowerCase().includes(needle))
      const matchesFilter = !filterValue || !filterColumn || row[filterColumn] === filterValue
      return matchesSearch && matchesFilter
    })
  }, [dataset, query, filterColumn, filterValue])

  const charts = useMemo<DataChart[]>(() => {
    if (!dataset?.rows.length) return []
    const result: DataChart[] = []
    const measure = numericColumns[0]
    const category = categoricalColumns[0]

    if (dateColumn && measure) {
      const daily = new Map<string, { mean: number; count: number }>()
      dataset.rows.forEach((row) => {
        const day = dateKey(row[dateColumn.name])
        const value = numericValue(row[measure.name])
        if (!day || value === null) return
        const current = daily.get(day) ?? { mean: 0, count: 0 }
        current.mean = current.mean * (current.count / (current.count + 1)) + value / (current.count + 1)
        current.count += 1
        daily.set(day, current)
      })
      const sortedValues = [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([label, item]) => ({ label, value: item.mean }))
      const values = sortedValues.length <= 36 ? sortedValues : Array.from({ length: 36 }, (_, index) => sortedValues[Math.round(index * (sortedValues.length - 1) / 35)])
      if (values.length) result.push({ id: 'date-trend', title: `Average ${measure.name} over time`, subtitle: `Daily average by ${dateColumn.name}`, kind: 'line', data: values, xLabel: dateColumn.name, yLabel: `Average ${measure.name}`, color: '#ff4655' })
    }

    if (category && measure) {
      const groups = new Map<string, { mean: number; count: number }>()
      dataset.rows.forEach((row) => {
        const label = row[category.name] || '(Missing)'
        const value = numericValue(row[measure.name])
        if (value === null) return
        const current = groups.get(label) ?? { mean: 0, count: 0 }
        current.mean = current.mean * (current.count / (current.count + 1)) + value / (current.count + 1)
        current.count += 1
        groups.set(label, current)
      })
      const averages = [...groups].map(([label, group]) => ({ label, value: group.mean })).sort((a, b) => b.value - a.value)
      const top = averages.slice(0, 7)
      if (averages.length > 7) {
        const remainder = averages.slice(7)
        let remainderMean = 0
        let remainderCount = 0
        remainder.forEach((item) => {
          const count = groups.get(item.label)?.count ?? 0
          const combined = remainderCount + count
          remainderMean = remainderMean * (remainderCount / combined) + item.value * (count / combined)
          remainderCount = combined
        })
        if (remainderCount) top.push({ label: 'Other categories', value: remainderMean })
      }
      if (top.length) result.push({ id: 'category-measure', title: `Average ${measure.name} by ${category.name}`, subtitle: 'Top categories · missing measures excluded', kind: 'bar', data: top, xLabel: category.name, yLabel: `Average ${measure.name}`, color: '#4b9fff' })
    }

    categoricalColumns.slice(0, 2).forEach((column, index) => {
      const counts = new Map<string, number>()
      dataset.rows.forEach((row) => {
        const label = row[column.name] || '(Missing)'
        counts.set(label, (counts.get(label) ?? 0) + 1)
      })
      const data = topCategories(counts)
      if (data.length) result.push({ id: `frequency-${index}`, title: `${column.name} frequency`, subtitle: 'Record count by category', kind: 'pie', data, xLabel: column.name, yLabel: 'Records', color: '#c7a8f5' })
    })

    if (!category && measure) {
      numericColumns.slice(0, 2).forEach((column, index) => {
        const values = dataset.rows.map((row) => numericValue(row[column.name])).filter((value): value is number => value !== null)
        if (!values.length) return
        const minimum = values.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY)
        const maximum = values.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY)
        const scale = Math.max(Math.abs(minimum), Math.abs(maximum), 1)
        const scaledMinimum = minimum / scale
        const scaledMaximum = maximum / scale
        const scaledRange = scaledMaximum - scaledMinimum
        const binCount = scaledRange === 0 ? 1 : Math.min(12, Math.max(5, Math.ceil(Math.sqrt(values.length))))
        const width = scaledRange / binCount || 1
        const bins = Array.from({ length: binCount }, (_, bin) => {
          const startFraction = bin / binCount
          const endFraction = (bin + 1) / binCount
          const start = minimum * (1 - startFraction) + maximum * startFraction
          const end = minimum * (1 - endFraction) + maximum * endFraction
          return { label: minimum === maximum ? `${minimum}` : `${start.toLocaleString(undefined, { maximumFractionDigits: 2 })}–${end.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, value: 0 }
        })
        values.forEach((value) => { const index = Math.max(0, Math.min(binCount - 1, Math.floor(((value / scale) - scaledMinimum) / width))); bins[index].value += 1 })
        result.push({ id: `histogram-${index}`, title: `${column.name} distribution`, subtitle: `${values.length.toLocaleString()} valid values · ${binCount} ranges`, kind: 'bar', data: bins, xLabel: column.name, yLabel: 'Records', color: index ? '#8fc7ff' : '#ff4655' })
      })
    }

    return result.slice(0, 3)
  }, [dataset, numericColumns, categoricalColumns, dateColumn])
  const kindIcon = (kind: ColumnKind) => kind === 'Numeric' ? <Activity size={13} /> : kind === 'Date' ? <CalendarDays size={13} /> : <Database size={13} />
  const distinctValues = filterColumn && dataset ? Array.from(new Set(dataset.rows.map((r) => r[filterColumn]).filter(Boolean))).slice(0, 100) : []

  return <div className={`dashboard-shell${spiderAnimation ? '' : ' no-spider-animation'}`} data-theme={theme}>
    <CinematicBackdrop />
    <aside className="sidebar"><a className="brand" href="#"><span className="brand-symbol"><BarChart3 size={19} /></span><span>Data<span className="brand-light">scope</span></span></a>
      <div className="side-caption">WORKSPACE</div><button className="side-link active"><LayoutDashboard size={17} /> Overview</button><button className="side-link" onClick={() => document.getElementById('preview')?.scrollIntoView({ behavior: 'smooth' })}><Table2 size={17} /> Data preview</button>
      <div className="side-bottom"><div className="privacy-card"><div className="privacy-icon"><Check size={14} /></div><strong>{supabaseConfigured ? 'Optional cloud sharing' : 'Private by design'}</strong><p>{supabaseConfigured ? 'CSV data remains local unless you choose to save a shareable dashboard.' : 'Your CSV stays in this browser. Add Supabase settings to enable dashboard sharing.'}</p></div><div className="profile"><span className="profile-dot">L</span><span><b>{supabaseConfigured ? 'Supabase configured' : 'Local workspace'}</b><small>{supabaseConfigured ? 'Cloud settings detected' : 'Free tier'}</small></span><ChevronDown size={14} /></div></div>
    </aside>
    <main className="main-content"><header className="topbar"><div className="crumb"><span>Workspace</span><span>/</span><b>Dataset explorer</b></div><div className="top-meta"><label className="theme-control"><Palette size={14} /><span className="sr-only">Choose dashboard theme</span><select aria-label="Choose dashboard theme" value={theme} onChange={(event) => setTheme(event.target.value as Theme)}><option value="light">Light</option><option value="dark">Dark</option><option value="spider">Spider-Man</option></select></label>{theme === 'spider' && <button className="animation-toggle" type="button" aria-pressed={spiderAnimation} onClick={() => setSpiderAnimation((enabled) => !enabled)} title={`${spiderAnimation ? 'Turn off' : 'Turn on'} Spider-Man background animation`}>{spiderAnimation ? <Pause size={13} /> : <Play size={13} />}<span>Motion {spiderAnimation ? 'on' : 'off'}</span></button>}<span className="local-badge"><i /> {supabaseConfigured ? 'SUPABASE CONFIGURED' : 'LOCAL ONLY'}</span><span className="top-divider" /><span className="avatar">L</span></div></header>
      <div className="content-wrap"><div className="page-title-row"><div><div className="eyebrow"><i /> DATA WORKSPACE</div><h1>Dataset explorer<span>.</span></h1><p className="subtitle">Get a clear picture of your data, in seconds.</p></div><div className="page-actions">{dataset && <button className="share-button" onClick={saveOrCopyDashboard} disabled={!supabaseConfigured || saving} title={!supabaseConfigured ? 'Set VITE_SUPABASE_URL and a publishable or anon key to enable saving.' : ''}><CloudUpload size={15} />{saving ? 'Saving…' : dashboardId ? 'Copy share link' : supabaseConfigured ? 'Save & share' : 'Cloud setup required'}</button>}<button className="upload-button" onClick={() => inputRef.current?.click()} disabled={busy || saving}><Upload size={16} /> {busy ? busyMessage : dataset ? 'Upload new CSV' : 'Upload a CSV'}<input ref={inputRef} type="file" accept=".csv,text/csv" onChange={onInput} /></button></div></div>
        {!dataset && <div className={`dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          {busy ? <div className="loader" /> : <span className="drop-icon"><FileUp size={23} /></span>}<h2>{busy ? busyMessage : 'Drop your CSV here'}</h2><p>or choose a file from your device. Your data stays private unless you save it.</p><button className="browse-button" onClick={() => inputRef.current?.click()} disabled={busy}>Browse files</button><small>CSV files · Any size that fits in your browser</small>
        </div>}
        {error && <div className="error-banner" role="alert"><CircleAlert size={17} /><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}
        {dataset && <>
          <div className="file-strip"><div className="file-badge"><Table2 size={16} /></div><div><b>{dataset.name}</b><small>Analyzed just now · CSV file</small></div><span className="file-ready"><i /> READY</span></div>
          {(shareUrl || shareMessage || !supabaseConfigured) && <div className="share-panel" role="status"><Link2 size={15} />{shareUrl ? <input aria-label="Shareable dashboard URL" readOnly value={shareUrl} onFocus={(event) => event.currentTarget.select()} /> : <span>{shareMessage || 'Cloud sharing is off. Configure Supabase in .env.local to save and share dashboards.'}</span>}{shareUrl && <button onClick={copyShareUrl} aria-label="Copy dashboard link"><Copy size={14} /> Copy</button>}</div>}
          {dataset.warnings.map((warning) => <div className="warning-banner" role="status" key={warning}><CircleAlert size={15} /><span>{warning}</span></div>)}
          <section className="stats-grid"><Stat label="Total rows" value={dataset.stats.totalRows.toLocaleString()} note="Records in dataset" icon={<Table2 size={16} />} /><Stat label="Total columns" value={dataset.stats.totalColumns} note="Fields detected" icon={<Database size={16} />} /><Stat label="Missing values" value={missingTotal.toLocaleString()} note={missingTotal ? 'Blank cells found' : 'No missing cells'} icon={<Filter size={16} />} /><Stat label="Column types" value={`${dataset.stats.types.Numeric} / ${dataset.stats.types.Categorical} / ${dataset.stats.types.Date}`} note="Numeric / text / date" icon={<Activity size={16} />} /></section>
          <DataQuality headers={dataset.headers} rows={dataset.rows} columns={dataset.columns} />
          <section className="section-block"><div className="section-heading"><div><h2>Quick insights</h2><p>Charts generated from the uploaded data</p></div><span className="section-note"><i /> AUTO-GENERATED</span></div>
            <div className="chart-grid">{charts.length ? charts.map((chart) => <ChartCard key={chart.id} chart={chart} theme={theme} />) : <div className="no-chart">No suitable values were found for a chart in this dataset.</div>}</div>
          </section>
          <section className="section-block preview-section" id="preview"><div className="section-heading"><div><h2>Data preview</h2><p>Explore and filter your uploaded records</p></div><span className="row-count">{filteredRows.length.toLocaleString()} <span>of {dataset.rows.length.toLocaleString()} rows</span></span></div>
            <div className="table-tools"><label className="search-box"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all columns…" /></label><label className="filter-select"><Filter size={14} /><select value={filterColumn} onChange={(e) => { setFilterColumn(e.target.value); setFilterValue('') }}><option value="">Filter column</option>{columns.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>{filterColumn && <label className="filter-select"><select value={filterValue} onChange={(e) => setFilterValue(e.target.value)}><option value="">All values</option>{distinctValues.map((v) => <option key={v}>{v}</option>)}</select></label>}</div>
            <div className="table-scroll"><table><thead><tr>{columns.map((c) => <th key={c.name}><span>{c.name}</span><small className={`type-pill ${c.kind.toLowerCase()}`}>{kindIcon(c.kind)} {c.kind}</small></th>)}</tr></thead><tbody>{filteredRows.slice(0, 100).map((row, index) => <tr key={index}>{dataset.headers.map((h) => <td key={h}>{row[h] ? row[h] : <span className="missing-cell">—</span>}</td>)}</tr>)}</tbody></table>{!filteredRows.length && <div className="no-results">No rows match your search or filter.</div>}</div><div className="table-footer">Showing {Math.min(filteredRows.length, 100)} of {filteredRows.length.toLocaleString()} matching rows <span>Missing values appear as —</span></div>
          </section>
          <footer className="page-footer">DATASCOPE <span>·</span> BUILT FOR CLEARER DECISIONS <span className="footer-right">Processed locally in your browser</span></footer>
        </>}
      </div>
    </main>
  </div>
}

function Stat({ label, value, note, icon }: { label: string; value: string | number; note: string; icon: ReactNode }) {
  return <article className="stat-card"><div className="stat-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><small>{note}</small></article>
}

function ChartCard({ chart, theme }: { chart: DataChart; theme: Theme }) {
  const palette = theme === 'spider' ? colors : theme === 'light' ? ['#e23c4d', '#246fc1', '#58a4e8', '#7754b8', '#d66c35', '#258e95', '#526bb5'] : ['#ff5261', '#55aaff', '#8fc7ff', '#c191ff', '#ff9f6e', '#63cbd1', '#a9b7ff']
  const lineColor = theme === 'spider' ? chart.color : chart.title.toLowerCase().includes('average') ? (theme === 'light' ? '#246fc1' : '#55aaff') : (theme === 'light' ? '#e23c4d' : '#ff5261')
  const tooltipStyle = { background: theme === 'light' ? '#ffffff' : '#111b2b', border: `1px solid ${theme === 'light' ? '#cbd5e1' : '#315279'}`, borderRadius: 8, color: theme === 'light' ? '#172033' : '#edf4ff', fontSize: 11 }
  const formatValue = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  const total = chart.data.reduce((sum, point) => sum + point.value, 0)
  return <article className="chart-card">
    <div className="chart-title"><div><h3>{chart.title}</h3><p>{chart.subtitle}</p></div><span className="chart-menu" aria-hidden="true">•••</span></div>
    <div className={`chart-area ${chart.kind === 'pie' ? 'pie-area' : ''}`}>
      <ResponsiveContainer width="100%" height="100%">
        {chart.kind === 'pie' ? <PieChart>
          <Pie data={chart.data} dataKey="value" nameKey="label" innerRadius={48} outerRadius={72} paddingAngle={3} stroke="none">
            {chart.data.map((point, index) => <Cell key={`${point.label}-${index}`} fill={palette[index % palette.length]} />)}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatValue(Number(value)), chart.yLabel]} />
        </PieChart> : chart.kind === 'line' ? <LineChart data={chart.data} margin={{ top: 8, right: 10, left: 2, bottom: 20 }}>
          <CartesianGrid stroke={theme === 'light' ? '#dbe2ec' : '#263752'} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: theme === 'light' ? '#536174' : '#aab9d0', fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" label={{ value: chart.xLabel, position: 'insideBottom', offset: -12, fill: theme === 'light' ? '#536174' : '#aab9d0', fontSize: 10 }} />
          <YAxis tick={{ fill: theme === 'light' ? '#536174' : '#aab9d0', fontSize: 9 }} axisLine={false} tickLine={false} width={46} label={{ value: chart.yLabel, angle: -90, position: 'insideLeft', fill: theme === 'light' ? '#536174' : '#aab9d0', fontSize: 10 }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatValue(Number(value)), chart.yLabel]} />
          <Line type="monotone" dataKey="value" name={chart.yLabel} stroke={lineColor} strokeWidth={2} dot={{ r: 2, fill: lineColor }} activeDot={{ r: 4 }} />
        </LineChart> : <BarChart data={chart.data} margin={{ top: 8, right: 10, left: 2, bottom: 34 }}>
          <CartesianGrid stroke={theme === 'light' ? '#dbe2ec' : '#263752'} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: theme === 'light' ? '#536174' : '#aab9d0', fontSize: 9 }} axisLine={false} tickLine={false} interval={0} angle={-18} textAnchor="end" height={44} label={{ value: chart.xLabel, position: 'insideBottom', offset: -27, fill: theme === 'light' ? '#536174' : '#aab9d0', fontSize: 10 }} />
          <YAxis tick={{ fill: theme === 'light' ? '#536174' : '#aab9d0', fontSize: 9 }} axisLine={false} tickLine={false} width={46} label={{ value: chart.yLabel, angle: -90, position: 'insideLeft', fill: theme === 'light' ? '#536174' : '#aab9d0', fontSize: 10 }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatValue(Number(value)), chart.yLabel]} />
          <Bar dataKey="value" name={chart.yLabel} fill={lineColor} radius={[4, 4, 0, 0]} />
        </BarChart>}
      </ResponsiveContainer>
      {chart.kind === 'pie' && <div className="pie-center"><strong>{total.toLocaleString()}</strong><small>RECORDS</small></div>}
    </div>
    {chart.kind === 'pie' ? <div className="legend-list">{chart.data.map((point, index) => <span key={`${point.label}-${index}`}><i style={{ background: palette[index % palette.length] }} />{point.label}<b>{formatValue(point.value)}</b></span>)}</div>
      : <div className="chart-legend"><i style={{ background: lineColor }} />{chart.yLabel}<span>{chart.data.length} {chart.kind === 'line' ? 'dates' : chart.title.includes('distribution') ? 'ranges' : 'categories'}</span></div>}
  </article>
}

export default App

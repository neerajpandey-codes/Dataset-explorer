import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, Copy, FileWarning } from 'lucide-react'

type QualityRow = Record<string, string>
type QualityColumn = { name: string; kind: 'Numeric' | 'Date' | 'Categorical' }
type DataQualityProps = { headers: string[]; rows: QualityRow[]; columns: QualityColumn[] }

function parseNumber(value: string): number | null {
  if (!value.trim()) return null
  const parsed = Number(value.replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function parseDate(value: string): boolean {
  if (!value.trim()) return false
  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (iso) {
    const [, year, month, day] = iso
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    return date.getUTCFullYear() === Number(year) && date.getUTCMonth() + 1 === Number(month) && date.getUTCDate() === Number(day)
  }
  return Number.isFinite(Date.parse(value))
}

export default function DataQuality({ headers, rows, columns }: DataQualityProps) {
  const report = useMemo(() => {
    const missing = headers.map((name) => ({ name, count: rows.reduce((count, row) => count + ((row[name] ?? '').trim() ? 0 : 1), 0) }))
    const seen = new Set<string>()
    let duplicateRows = 0
    rows.forEach((row) => {
      const signature = JSON.stringify(headers.map((header) => row[header] ?? ''))
      if (seen.has(signature)) duplicateRows += 1
      else seen.add(signature)
    })
    const invalid = columns.flatMap((column) => {
      if (column.kind === 'Categorical') return []
      const count = rows.reduce((total, row) => {
        const value = (row[column.name] ?? '').trim()
        if (!value) return total
        const valid = column.kind === 'Numeric' ? parseNumber(value) !== null : parseDate(value)
        return total + (valid ? 0 : 1)
      }, 0)
      return count ? [{ name: column.name, kind: column.kind, count }] : []
    })
    const missingTotal = missing.reduce((total, column) => total + column.count, 0)
    const issueCount = missingTotal + duplicateRows + invalid.reduce((total, column) => total + column.count, 0)
    return { missing, duplicateRows, invalid, missingTotal, issueCount }
  }, [headers, rows, columns])

  return <section className="quality-section section-block" aria-labelledby="quality-heading">
    <div className="section-heading"><div><h2 id="quality-heading">Data quality</h2><p>Read-only checks on the uploaded values</p></div><span className={`quality-status${report.issueCount ? ' has-issues' : ''}`}>{report.issueCount ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}{report.issueCount ? `${report.issueCount.toLocaleString()} detected issue${report.issueCount === 1 ? '' : 's'}` : 'No detected issues'}</span></div>
    <div className="quality-summary">
      <article><span><FileWarning size={14} /> Missing cells</span><strong>{report.missingTotal.toLocaleString()}</strong></article>
      <article><span><Copy size={14} /> Duplicate rows</span><strong>{report.duplicateRows.toLocaleString()}</strong></article>
      <article><span><AlertTriangle size={14} /> Invalid typed values</span><strong>{report.invalid.reduce((total, column) => total + column.count, 0).toLocaleString()}</strong></article>
    </div>
    <div className="quality-details">
      <div className="quality-list"><h3>Missing values by column</h3>{report.missing.length ? report.missing.map((column) => <div key={column.name}><span>{column.name}</span><b>{column.count.toLocaleString()}</b></div>) : <p>No columns available to check.</p>}</div>
      <div className="quality-list"><h3>Invalid numbers and dates</h3>{report.invalid.length ? report.invalid.map((column) => <div key={column.name}><span>{column.name} <small>{column.kind}</small></span><b>{column.count.toLocaleString()}</b></div>) : <p>No invalid values found in detected numeric/date columns.</p>}</div>
    </div>
    <p className="quality-footnote">Missing cells and invalid values are counted separately. Duplicate rows count repeated records after the first. Original data is unchanged.</p>
  </section>
}

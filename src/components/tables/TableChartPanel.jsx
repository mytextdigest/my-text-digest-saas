'use client'
import { useEffect, useMemo, useState } from 'react';
import ChartMessage from '@/components/chat/ChartMessage';
import { cn } from '@/lib/utils';
import { cellText, colLabel, isNumericCol } from './tableFormat';

const CHART_TYPES = [
  { value: 'bar', label: 'Bar' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' },
];

function fmt(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Charts and statistics built directly from the table's cell values (FR-23,
// FR-24) — no model involved, so the chart always matches the table.
export default function TableChartPanel({ table, title, stats }) {
  const labelCols = useMemo(() => (table?.columns || []).map((c, j) => ({ c, j })).filter(({ c }) => !isNumericCol(c)), [table]);
  const valueCols = useMemo(() => (table?.columns || []).map((c, j) => ({ c, j })).filter(({ c }) => isNumericCol(c)), [table]);
  const [xCol, setXCol] = useState(labelCols[0]?.j ?? 0);
  const [series, setSeries] = useState(() => valueCols.slice(0, 3).map((v) => v.j));
  const [type, setType] = useState('bar');
  const [includeTotals, setIncludeTotals] = useState(false);

  useEffect(() => {
    setXCol(labelCols[0]?.j ?? 0);
    setSeries(valueCols.slice(0, 3).map((v) => v.j));
  }, [labelCols, valueCols]);

  const spec = useMemo(() => {
    if (!table || !series.length) return null;
    const rows = table.rows.filter((r) => r.kind !== 'section' && (includeTotals || (r.kind !== 'total' && r.kind !== 'subtotal')));
    const used = type === 'pie' ? series.slice(0, 1) : series;
    const unit = table.columns[used[0]]?.unit || table.tableUnit;
    return {
      type,
      title: title || 'Table',
      categories: rows.map((r) => cellText(r.cells[xCol])),
      series: used.map((j) => ({ name: colLabel(table.columns[j], j), data: rows.map((r) => (typeof r.cells[j]?.v === 'number' ? r.cells[j].v : null)) })),
      yLabel: unit || undefined,
    };
  }, [table, series, xCol, type, includeTotals, title]);

  if (!table) return null;
  if (!valueCols.length) {
    return <p className="text-xs text-gray-500 dark:text-gray-400 py-4">This table has no numeric columns to chart.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1.5 text-gray-500">
          Labels
          <select value={xCol} onChange={(e) => setXCol(Number(e.target.value))} className="px-1.5 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200">
            {(labelCols.length ? labelCols : table.columns.map((c, j) => ({ c, j }))).map(({ c, j }) => <option key={c.id} value={j}>{colLabel(c, j) || 'First column'}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
          {CHART_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={cn('text-xs px-2.5 py-1 rounded transition-colors',
                type === t.value ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400' : 'text-gray-400 hover:text-gray-600')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-gray-500">
          <input type="checkbox" checked={includeTotals} onChange={(e) => setIncludeTotals(e.target.checked)} /> Include totals
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {valueCols.map(({ c, j }) => {
          const on = series.includes(j);
          return (
            <button
              key={c.id}
              onClick={() => setSeries((s) => (on ? s.filter((x) => x !== j) : [...s, j]))}
              className={cn('text-[11px] px-2 py-0.5 rounded-full border transition-colors',
                on ? 'border-primary-300 bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-700' : 'border-gray-200 text-gray-500 dark:border-gray-700')}
            >
              {colLabel(c, j)}
            </button>
          );
        })}
      </div>
      {spec && spec.series.length > 0 ? <ChartMessage spec={spec} /> : <p className="text-xs text-gray-500">Pick at least one column to chart.</p>}

      {stats?.columns?.some((c) => c.type !== 'text' && c.count) && (
        <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full text-xs text-gray-700 dark:text-gray-300">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                {['Column', 'Count', 'Min', 'Max', 'Sum', 'Mean', 'Median'].map((h) => (
                  <th key={h} className={cn('px-2.5 py-1.5 font-semibold border-b border-gray-200 dark:border-gray-700', h === 'Column' ? 'text-left' : 'text-right')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.columns.filter((c) => c.type !== 'text' && c.count).map((c) => (
                <tr key={c.id}>
                  <td className="px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-800">{c.label}{c.unit ? <span className="text-gray-400"> ({c.unit})</span> : null}</td>
                  <td className="px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-800 text-right tabular-nums">{c.count}</td>
                  <td className="px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-800 text-right tabular-nums" title={c.minLabel || undefined}>{fmt(c.min)}</td>
                  <td className="px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-800 text-right tabular-nums" title={c.maxLabel || undefined}>{fmt(c.max)}</td>
                  <td className="px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-800 text-right tabular-nums">{fmt(c.sum)}</td>
                  <td className="px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-800 text-right tabular-nums">{fmt(c.mean)}</td>
                  <td className="px-2.5 py-1.5 border-b border-gray-100 dark:border-gray-800 text-right tabular-nums">{fmt(c.median)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stats.excludedRows > 0 && (
            <p className="px-2.5 py-1.5 text-[11px] text-gray-400">Totals, subtotals and section rows are excluded from these statistics.</p>
          )}
        </div>
      )}
    </div>
  );
}

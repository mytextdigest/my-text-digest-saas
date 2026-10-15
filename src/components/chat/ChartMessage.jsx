'use client'

import { useRef, useState } from "react"
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
  PieChart, Pie, Cell, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from "recharts"
import { Download, Printer, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { seriesColor, chartChrome } from "@/lib/chartPalette"
import { printHtml } from "@/lib/printDocument"

// Charts always render on a fixed light surface, independent of the app's
// theme — this keeps the on-screen chart, the downloaded PNG, and the
// printed page visually identical (no dark-on-dark export bugs).
const chrome = chartChrome("light")

function toChartRows(spec) {
  return spec.categories.map((cat, i) => {
    const row = { name: cat }
    spec.series.forEach((s) => { row[s.name] = s.data[i] ?? null })
    return row
  })
}

function slugify(title) {
  return (title || "chart").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "chart"
}

export default function ChartMessage({ spec }) {
  const chartRef = useRef(null)
  const [isExporting, setIsExporting] = useState(false)

  if (!spec || !spec.type || !Array.isArray(spec.series) || spec.series.length === 0) return null
  if (spec.type !== "scatter" && (!Array.isArray(spec.categories) || spec.categories.length === 0)) return null

  const hasLegend = spec.type === "pie" || spec.series.length > 1
  const rows = spec.type !== "scatter" && spec.type !== "pie" ? toChartRows(spec) : null
  const pieRows = spec.type === "pie"
    ? spec.categories.map((cat, i) => ({ name: cat, value: spec.series[0].data[i] })).filter(r => Number.isFinite(r.value))
    : null

  const captureNode = async () => {
    const { toPng } = await import("html-to-image")
    return toPng(chartRef.current, { backgroundColor: chrome.surface, pixelRatio: 2 })
  }

  const handleDownload = async () => {
    if (!chartRef.current) return
    setIsExporting(true)
    try {
      const dataUrl = await captureNode()
      const a = document.createElement("a")
      a.href = dataUrl
      a.download = `chart-${slugify(spec.title)}.png`
      a.click()
    } catch (e) {
      console.error("Chart PNG export failed:", e)
    } finally {
      setIsExporting(false)
    }
  }

  const handlePrint = async () => {
    if (!chartRef.current) return
    setIsExporting(true)
    try {
      const dataUrl = await captureNode()
      const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><title>${spec.title}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; max-width: 720px; margin: 40px auto; color: #0b0b0b; }
  h1 { font-size: 1.2rem; margin-bottom: 1rem; }
  img { max-width: 100%; }
  @media print { body { margin: 20px; } }
</style></head>
<body><h1>${spec.title}</h1><img src="${dataUrl}" /></body></html>`
      await printHtml(html)
    } catch (e) {
      console.error("Chart print failed:", e)
    } finally {
      setIsExporting(false)
    }
  }

  const axisProps = { stroke: chrome.axis, tick: { fill: chrome.mutedInk, fontSize: 12 } }
  const gridProps = { stroke: chrome.gridline, strokeDasharray: "3 3", vertical: false }
  const tooltipProps = {
    contentStyle: {
      background: chrome.surface,
      border: `1px solid ${chrome.gridline}`,
      borderRadius: 8,
      fontSize: 12,
      color: chrome.primaryInk,
    },
  }
  const legendProps = { wrapperStyle: { fontSize: 12, color: chrome.secondaryInk } }

  let chartEl = null
  if (spec.type === "bar") {
    chartEl = (
      <BarChart data={rows} barGap={2}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} />
        <Tooltip {...tooltipProps} />
        {hasLegend && <Legend {...legendProps} />}
        {spec.series.map((s, i) => (
          <Bar key={s.name} dataKey={s.name} fill={seriesColor(i)} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    )
  } else if (spec.type === "line") {
    chartEl = (
      <LineChart data={rows}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} />
        <Tooltip {...tooltipProps} />
        {hasLegend && <Legend {...legendProps} />}
        {spec.series.map((s, i) => (
          <Line key={s.name} type="monotone" dataKey={s.name} stroke={seriesColor(i)} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
        ))}
      </LineChart>
    )
  } else if (spec.type === "area") {
    chartEl = (
      <AreaChart data={rows}>
        <CartesianGrid {...gridProps} />
        <XAxis dataKey="name" {...axisProps} />
        <YAxis {...axisProps} />
        <Tooltip {...tooltipProps} />
        {hasLegend && <Legend {...legendProps} />}
        {spec.series.map((s, i) => (
          <Area key={s.name} type="monotone" dataKey={s.name} stroke={seriesColor(i)} fill={seriesColor(i)} fillOpacity={0.25} strokeWidth={2} />
        ))}
      </AreaChart>
    )
  } else if (spec.type === "pie") {
    if (!pieRows || pieRows.length === 0) return null
    chartEl = (
      <PieChart>
        <Tooltip {...tooltipProps} />
        <Legend {...legendProps} />
        <Pie data={pieRows} dataKey="value" nameKey="name" outerRadius="80%" label={{ fontSize: 12, fill: chrome.secondaryInk }}>
          {pieRows.map((_, i) => <Cell key={i} fill={seriesColor(i)} />)}
        </Pie>
      </PieChart>
    )
  } else if (spec.type === "scatter") {
    chartEl = (
      <ScatterChart>
        <CartesianGrid {...gridProps} />
        <XAxis type="number" dataKey="x" name={spec.xAxisLabel || "x"} {...axisProps} />
        <YAxis type="number" dataKey="y" name={spec.yAxisLabel || "y"} {...axisProps} />
        <Tooltip {...tooltipProps} cursor={{ strokeDasharray: "3 3" }} />
        {hasLegend && <Legend {...legendProps} />}
        {spec.series.map((s, i) => (
          <Scatter key={s.name} name={s.name} data={s.data} fill={seriesColor(i)} />
        ))}
      </ScatterChart>
    )
  }

  if (!chartEl) return null

  return (
    <div
      className="mt-2 w-full max-w-xl rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden"
      style={{ background: chrome.surface }}
    >
      <div ref={chartRef} className="p-4" style={{ background: chrome.surface }}>
        <h4 className="text-sm font-semibold mb-2" style={{ color: chrome.primaryInk }}>
          {spec.title}
        </h4>
        <ResponsiveContainer width="100%" height={280}>
          {chartEl}
        </ResponsiveContainer>
      </div>
      <div
        className="flex items-center justify-end gap-2 px-4 py-2 border-t"
        style={{ borderColor: chrome.gridline, background: chrome.surface }}
      >
        <Button variant="outline" size="sm" onClick={handleDownload} disabled={isExporting}>
          {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          <span className="ml-1.5">Download PNG</span>
        </Button>
        <Button variant="outline" size="sm" onClick={handlePrint} disabled={isExporting}>
          <Printer className="w-3.5 h-3.5" />
          <span className="ml-1.5">Print</span>
        </Button>
      </div>
    </div>
  )
}

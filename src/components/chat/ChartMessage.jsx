"use client";

import { useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  BarChart, Bar,
  LineChart, Line,
  AreaChart, Area,
  PieChart, Pie, Cell,
  ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { toPng } from "html-to-image";
import { Download, Printer } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CATEGORICAL, CHROME } from "@/lib/chartPalette";

function slugify(s) {
  return (
    String(s || "chart")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "chart"
  );
}

const axisTick = { fill: CHROME.secondaryInk, fontSize: 12 };
const tooltipStyle = {
  background: CHROME.surface,
  border: `1px solid ${CHROME.gridline}`,
  color: CHROME.primaryInk,
};

function axisLabel(text, isY) {
  if (!text) return undefined;
  return isY
    ? { value: text, angle: -90, position: "insideLeft", fill: CHROME.secondaryInk }
    : { value: text, position: "insideBottom", offset: -5, fill: CHROME.secondaryInk };
}

// Props: { spec } only — no knowledge of documentId/projectId/conversationId.
// Chart chrome (axis/grid/title/marks) stays fixed-light regardless of the app's
// theme, so what's on screen, downloaded, and printed are always identical.
export default function ChartMessage({ spec }) {
  const chartRef = useRef(null);
  const [isExporting, setIsExporting] = useState(false);

  const rows = useMemo(() => {
    if (!spec || spec.type === "scatter") return [];
    return spec.categories.map((cat, i) => {
      const row = { name: cat };
      spec.series.forEach((s) => {
        row[s.name] = s.data[i];
      });
      return row;
    });
  }, [spec]);

  if (!spec || !spec.type) return null;

  const handleDownload = async () => {
    if (!chartRef.current) return;
    setIsExporting(true);
    try {
      const dataUrl = await toPng(chartRef.current, {
        backgroundColor: CHROME.surface,
        pixelRatio: 2,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `chart-${slugify(spec.title)}.png`;
      a.click();
    } catch (err) {
      console.error("Chart PNG export failed:", err);
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = async () => {
    if (!chartRef.current) return;
    try {
      const dataUrl = await toPng(chartRef.current, {
        backgroundColor: CHROME.surface,
        pixelRatio: 2,
      });

      const printWindow = window.open("", "_blank");
      printWindow.document.write(`
        <html>
          <head>
            <title>${spec.title}</title>
            <style>
              body { font-family: system-ui, sans-serif; padding: 24px; text-align: center; }
              img { max-width: 100%; }
            </style>
          </head>
          <body>
            <h2>${spec.title}</h2>
            <img src="${dataUrl}" />
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (err) {
      console.error("Chart print failed:", err);
    }
  };

  const renderChart = () => {
    switch (spec.type) {
      case "bar":
        return (
          <BarChart data={rows}>
            <CartesianGrid stroke={CHROME.gridline} strokeDasharray="3 3" />
            <XAxis dataKey="name" stroke={CHROME.axis} tick={axisTick} label={axisLabel(spec.xAxisLabel, false)} />
            <YAxis stroke={CHROME.axis} tick={axisTick} label={axisLabel(spec.yAxisLabel, true)} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ color: CHROME.secondaryInk }} />
            {spec.series.map((s, i) => (
              <Bar key={s.name} dataKey={s.name} fill={CATEGORICAL[i % CATEGORICAL.length]} />
            ))}
          </BarChart>
        );

      case "line":
        return (
          <LineChart data={rows}>
            <CartesianGrid stroke={CHROME.gridline} strokeDasharray="3 3" />
            <XAxis dataKey="name" stroke={CHROME.axis} tick={axisTick} label={axisLabel(spec.xAxisLabel, false)} />
            <YAxis stroke={CHROME.axis} tick={axisTick} label={axisLabel(spec.yAxisLabel, true)} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ color: CHROME.secondaryInk }} />
            {spec.series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={CATEGORICAL[i % CATEGORICAL.length]}
                connectNulls={false}
                dot={{ r: 3 }}
              />
            ))}
          </LineChart>
        );

      case "area":
        return (
          <AreaChart data={rows}>
            <CartesianGrid stroke={CHROME.gridline} strokeDasharray="3 3" />
            <XAxis dataKey="name" stroke={CHROME.axis} tick={axisTick} label={axisLabel(spec.xAxisLabel, false)} />
            <YAxis stroke={CHROME.axis} tick={axisTick} label={axisLabel(spec.yAxisLabel, true)} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ color: CHROME.secondaryInk }} />
            {spec.series.map((s, i) => (
              <Area
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={CATEGORICAL[i % CATEGORICAL.length]}
                fill={CATEGORICAL[i % CATEGORICAL.length]}
                fillOpacity={0.3}
                connectNulls={false}
              />
            ))}
          </AreaChart>
        );

      case "pie": {
        const pieData = spec.categories.map((cat, i) => ({
          name: cat,
          value: spec.series[0]?.data[i] ?? 0,
        }));
        return (
          <PieChart>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ color: CHROME.secondaryInk }} />
            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
              {pieData.map((_, i) => (
                <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />
              ))}
            </Pie>
          </PieChart>
        );
      }

      case "scatter":
        return (
          <ScatterChart>
            <CartesianGrid stroke={CHROME.gridline} strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" stroke={CHROME.axis} tick={axisTick} label={axisLabel(spec.xAxisLabel, false)} />
            <YAxis type="number" dataKey="y" stroke={CHROME.axis} tick={axisTick} label={axisLabel(spec.yAxisLabel, true)} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ color: CHROME.secondaryInk }} />
            {spec.series.map((s, i) => (
              <Scatter key={s.name} name={s.name} data={s.data} fill={CATEGORICAL[i % CATEGORICAL.length]} />
            ))}
          </ScatterChart>
        );

      default:
        return null;
    }
  };

  return (
    <Card className="mt-2 w-full max-w-full border-gray-200 dark:border-gray-700 overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{spec.title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div ref={chartRef} style={{ backgroundColor: CHROME.surface }} className="p-3 rounded-lg">
          <ResponsiveContainer width="100%" height={300}>
            {renderChart()}
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-end gap-2 pt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={isExporting}
            className="flex items-center space-x-2"
          >
            <Download className="h-4 w-4" />
            <span>Download PNG</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint} className="flex items-center space-x-2">
            <Printer className="h-4 w-4" />
            <span>Print</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

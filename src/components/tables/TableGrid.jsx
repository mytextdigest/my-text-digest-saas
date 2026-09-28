'use client'
import { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { cellText, colLabel, isNumericCol, newId, sortRows, rawToDisplay } from './tableFormat';

const COLUMN_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percent' },
];

// Read-only raw layer: header rows exactly as detected, spans honoured.
function RawGrid({ table }) {
  const { headerRows, bodyRows } = rawToDisplay(table);
  const renderRow = (row, isHeader) => (
    <tr key={row.id} className={isHeader ? 'bg-gray-50 dark:bg-gray-800' : undefined}>
      {row.cells.map((cell, j) => {
        if (cell.spanned) return null;
        const Tag = isHeader ? 'th' : 'td';
        return (
          <Tag
            key={j}
            colSpan={cell.colSpan || undefined}
            rowSpan={cell.rowSpan || undefined}
            className={cn(
              'px-2.5 py-1.5 border-b border-r border-gray-100 dark:border-gray-800 text-left align-top whitespace-pre-wrap',
              isHeader && 'font-semibold text-gray-700 dark:text-gray-200',
              cell.flag === 'ungrounded' && 'underline decoration-yellow-500 decoration-wavy'
            )}
          >
            {cellText(cell)}
          </Tag>
        );
      })}
    </tr>
  );
  return (
    <table className="min-w-full text-xs text-gray-700 dark:text-gray-300 border-collapse">
      <thead>{headerRows.map((r) => renderRow(r, true))}</thead>
      <tbody>{bodyRows.map((r) => renderRow(r, false))}</tbody>
    </table>
  );
}

// Clean / effective / derived tables. In edit mode every cell is an input;
// Enter and the arrow keys move between cells (left/right only at the
// caret's edge), Tab moves right as usual.
export default function TableGrid({ table, layer = 'clean', editable = false, onChange, maxHeight = '60vh', sortable = true, dense = false }) {
  const [sort, setSort] = useState(null); // { col, dir }
  const inputs = useRef({});

  const rows = useMemo(() => {
    if (!table?.rows) return [];
    if (!sort || editable) return table.rows;
    return sortRows(table.rows, sort.col, sort.dir, isNumericCol(table.columns[sort.col]));
  }, [table, sort, editable]);

  if (!table) return null;
  if (layer === 'raw') {
    return (
      <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 custom-scrollbar" style={{ maxHeight }}>
        <RawGrid table={table} />
      </div>
    );
  }

  const update = (fn) => {
    const next = JSON.parse(JSON.stringify(table));
    fn(next);
    onChange?.(next);
  };

  const focusCell = (r, c) => {
    const el = inputs.current[`${r}:${c}`];
    if (el) { el.focus(); el.select?.(); }
  };

  const onKeyDown = (e, r, c) => {
    const el = e.currentTarget;
    if (e.key === 'Enter') { e.preventDefault(); focusCell(r + 1, c); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); focusCell(r + 1, c); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusCell(r - 1, c); }
    else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length) { e.preventDefault(); focusCell(r, c + 1); }
    else if (e.key === 'ArrowLeft' && el.selectionEnd === 0) { e.preventDefault(); focusCell(r, c - 1); }
  };

  const addRow = (afterIdx) => update((t) => {
    t.rows.splice(afterIdx + 1, 0, { id: newId('r'), kind: 'data', cells: t.columns.map(() => ({ raw: '' })) });
  });
  const removeRow = (idx) => update((t) => { t.rows.splice(idx, 1); });
  const addCol = (afterIdx) => update((t) => {
    const id = newId('c');
    t.columns.splice(afterIdx + 1, 0, { id, label: '', headerPath: [''], type: 'text', unit: null });
    t.rows.forEach((row) => row.cells.splice(afterIdx + 1, 0, { raw: '' }));
  });
  const removeCol = (idx) => update((t) => {
    if (t.columns.length <= 1) return;
    t.columns.splice(idx, 1);
    t.rows.forEach((row) => row.cells.splice(idx, 1));
  });
  const setType = (idx, type) => update((t) => { t.columns[idx].type = type; t.columns[idx].typeLocked = true; });
  const setLabel = (idx, label) => update((t) => { t.columns[idx].label = label; t.columns[idx].headerPath = [label]; });
  const setCell = (r, c, raw) => update((t) => { t.rows[r].cells[c] = { raw }; });

  const toggleSort = (j) => {
    if (!sortable || editable) return;
    setSort((s) => (s?.col === j ? (s.dir === 'asc' ? { col: j, dir: 'desc' } : null) : { col: j, dir: 'asc' }));
  };

  const pad = dense ? 'px-2 py-1' : 'px-2.5 py-1.5';

  return (
    <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 custom-scrollbar" style={{ maxHeight }}>
      <table className="min-w-full text-xs text-gray-700 dark:text-gray-300 border-collapse">
        <thead className="sticky top-0 z-20">
          <tr className="bg-gray-50 dark:bg-gray-800">
            {editable && <th className="w-12 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700" />}
            {table.columns.map((col, j) => (
              <th
                key={col.id}
                title={(col.headerPath || []).join(' › ') + (col.unit ? ` (${col.unit})` : '')}
                onClick={() => toggleSort(j)}
                className={cn(
                  pad,
                  'font-semibold text-gray-700 dark:text-gray-200 border-b border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 align-bottom',
                  isNumericCol(col) ? 'text-right' : 'text-left',
                  j === 0 && 'sticky left-0 z-30',
                  sortable && !editable && 'cursor-pointer select-none hover:text-primary-600'
                )}
              >
                {editable ? (
                  <div className="flex flex-col gap-1 min-w-[7rem]">
                    <div className="flex items-center gap-1">
                      <input
                        value={col.label || ''}
                        placeholder={colLabel(col, j) || 'Label'}
                        onChange={(e) => setLabel(j, e.target.value)}
                        className="flex-1 min-w-0 px-1.5 py-0.5 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 font-semibold"
                      />
                      <button onClick={() => addCol(j)} title="Insert column to the right" className="p-0.5 text-gray-400 hover:text-primary-600"><Plus className="w-3 h-3" /></button>
                      <button onClick={() => removeCol(j)} title="Delete column" className="p-0.5 text-gray-400 hover:text-red-600"><X className="w-3 h-3" /></button>
                    </div>
                    <select
                      value={col.type || 'text'}
                      onChange={(e) => setType(j, e.target.value)}
                      className="text-[10px] font-normal px-1 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
                    >
                      {COLUMN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                ) : (
                  <span className={cn('inline-flex items-center gap-1', isNumericCol(col) && 'justify-end')}>
                    {colLabel(col, j)}
                    {sort?.col === j && (sort.dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const emphasised = row.kind === 'total' || row.kind === 'subtotal';
            const section = row.kind === 'section';
            return (
              <tr key={row.id} className={cn('group', emphasised && 'bg-gray-50/70 dark:bg-gray-800/50', section && 'bg-primary-50/40 dark:bg-primary-900/10')}>
                {editable && (
                  <td className="border-b border-gray-100 dark:border-gray-800 px-1 whitespace-nowrap">
                    <button onClick={() => addRow(i)} title="Insert row below" className="p-0.5 text-gray-300 hover:text-primary-600"><Plus className="w-3 h-3" /></button>
                    <button onClick={() => removeRow(i)} title="Delete row" className="p-0.5 text-gray-300 hover:text-red-600"><X className="w-3 h-3" /></button>
                  </td>
                )}
                {row.cells.map((cell, j) => {
                  const col = table.columns[j];
                  const numeric = isNumericCol(col);
                  return (
                    <td
                      key={`${row.id}-${j}`}
                      title={cell.src ? `${cell.src.documentName}${cell.src.page ? `, p. ${cell.src.page}` : ''}${cell.calc ? ` · ${cell.calc}` : ''}` : cell.calc || undefined}
                      className={cn(
                        pad,
                        'border-b border-r border-gray-100 dark:border-gray-800 align-top',
                        numeric ? 'text-right tabular-nums whitespace-nowrap' : 'text-left',
                        j === 0 && 'sticky left-0 z-10 bg-white dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800',
                        (emphasised || section) && 'font-semibold',
                        cell.flag === 'ungrounded' && 'underline decoration-yellow-500 decoration-wavy',
                        cell.flag === 'total_mismatch' && 'underline decoration-red-500 decoration-wavy',
                        cell.restated && 'underline decoration-amber-500 decoration-dotted'
                      )}
                    >
                      {editable ? (
                        <input
                          ref={(el) => { inputs.current[`${i}:${j}`] = el; }}
                          value={cellText(cell)}
                          onChange={(e) => setCell(i, j, e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, i, j)}
                          className={cn(
                            'w-full min-w-[5rem] px-1 py-0.5 rounded border border-transparent focus:border-primary-400 bg-transparent focus:bg-white dark:focus:bg-gray-900 outline-none',
                            numeric && 'text-right'
                          )}
                        />
                      ) : (
                        <>
                          {cellText(cell)}
                          {cell.note && <sup className="ml-0.5 text-[9px] text-gray-400">{cell.note}</sup>}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {editable && rows.length === 0 && (
            <tr><td colSpan={table.columns.length + 1} className="p-2"><button onClick={() => addRow(-1)} className="text-xs text-primary-600">+ Add row</button></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

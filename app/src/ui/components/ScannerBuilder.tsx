import { useMemo, useState } from 'react'
import {
  FIELDS, FIELD_MAP, OPERATORS, fieldOperand, newGroup, newRule, valueOperand, validateTree,
  type Group, type Node, type Operand, type Rule, type ScannerConfig,
} from '../../domain/scanner'

/* ── immutable tree helpers ── */
const mapNode = (n: Node, id: string, fn: (n: Node) => Node | null): Node | null => {
  if (n.id === id) return fn(n)
  if (n.type === 'group') return { ...n, children: n.children.flatMap(c => { const r = mapNode(c, id, fn); return r ? [r] : [] }) }
  return n
}
const GROUPS = ['Price & volume', 'Trend', 'Momentum', 'Volatility', 'Lookback', 'Relative'] as const

function OperandEditor({ o, onChange, allowValue, tf }: { o: Operand; onChange: (o: Operand) => void; allowValue: boolean; tf: ScannerConfig['timeframe'] }) {
  const def = o.kind === 'field' ? FIELD_MAP[o.field] : null
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <select
        className="field !py-1.5 text-xs sm:!w-auto sm:max-w-[190px] sm:!py-1"
        value={o.kind === 'value' ? '__value__' : o.field}
        onChange={e => onChange(e.target.value === '__value__' ? valueOperand(0) : fieldOperand(e.target.value, Object.fromEntries(FIELD_MAP[e.target.value].params.map(p => [p.name, p.default]))))}
      >
        {GROUPS.map(g => (
          <optgroup key={g} label={g}>
            {FIELDS.filter(f => f.group === g && (!f.intradayOnly || tf !== '1D')).map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
          </optgroup>
        ))}
        {allowValue && <option value="__value__">Number…</option>}
      </select>
      {def?.params.map(p => (
        <label key={p.name} className="flex items-center gap-1 text-[11px] text-mute">
          {p.label}
          <input className="field num !w-14 !px-1.5 !py-1 text-xs" type="number" min={p.min} max={p.max} value={(o.kind === 'field' ? o.params[p.name] : undefined) ?? p.default} onChange={e => onChange({ ...(o as Extract<Operand, { kind: 'field' }>), params: { ...(o as Extract<Operand, { kind: 'field' }>).params, [p.name]: Number(e.target.value) } })} />
        </label>
      ))}
      {o.kind === 'value' && <input className="field num !w-24 !py-1 text-xs" type="number" step="any" value={o.value} onChange={e => onChange(valueOperand(Number(e.target.value)))} />}
    </div>
  )
}

function RuleRow({ r, update, remove, tf }: { r: Rule; update: (r: Rule) => void; remove: () => void; tf: ScannerConfig['timeframe'] }) {
  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-line/80 bg-bg/40 p-2.5 sm:flex-row sm:flex-wrap sm:items-center ${r.enabled ? '' : 'opacity-45'}`}>
      <div className="flex items-center justify-between sm:contents">
        <label className="flex items-center gap-2 text-xs text-mute sm:block">
          <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={r.enabled} onChange={e => update({ ...r, enabled: e.target.checked })} aria-label="Enabled" />
          <span className="sm:hidden">Condition on</span>
        </label>
        <button className="btn btn-sm btn-ghost text-down sm:order-last sm:ml-auto" onClick={remove} aria-label="Remove condition">Remove ✕</button>
      </div>
      <OperandEditor o={r.left} onChange={left => update({ ...r, left })} allowValue={false} tf={tf} />
      <select className="field !py-1.5 text-xs sm:!w-auto sm:!py-1" value={r.op} onChange={e => update({ ...r, op: e.target.value as Rule['op'], pct: e.target.value === 'withinPct' ? r.pct ?? 2 : r.pct })}>
        {OPERATORS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      {r.op === 'withinPct' && <input className="field num !w-16 !py-1 text-xs" type="number" step="0.1" min={0} value={r.pct ?? 0} onChange={e => update({ ...r, pct: Number(e.target.value) })} aria-label="Tolerance %" />}
      <OperandEditor o={r.right} onChange={right => update({ ...r, right })} allowValue={r.op !== 'withinPct'} tf={tf} />
    </div>
  )
}

function GroupEditor({ g, update, remove, tf, depth }: { g: Group; update: (g: Group) => void; remove?: () => void; tf: ScannerConfig['timeframe']; depth: number }) {
  const setChild = (i: number, n: Node | null) => update({ ...g, children: n ? g.children.map((c, j) => (j === i ? n : c)) : g.children.filter((_, j) => j !== i) })
  return (
    <div className={`space-y-2 rounded-2xl border p-3 ${depth === 0 ? 'border-line bg-panel2/30' : 'border-accent/25 bg-accent/[0.03]'} ${g.enabled ? '' : 'opacity-50'}`}>
      <div className="flex items-center gap-2">
        <div className="flex rounded-lg bg-bg/60 p-0.5 text-xs font-semibold">
          {(['ALL', 'ANY'] as const).map(m => (
            <button key={m} onClick={() => update({ ...g, mode: m })} className={`rounded-md px-2.5 py-1 transition ${g.mode === m ? 'bg-accent text-[#04121c]' : 'text-mute hover:text-ink'}`}>{m}</button>
          ))}
        </div>
        <span className="text-xs text-mute">{g.mode === 'ALL' ? 'every condition must pass' : 'at least one must pass'}</span>
        {remove && <button className="btn btn-sm btn-ghost ml-auto text-down" onClick={remove}>Remove group</button>}
      </div>
      {g.children.map((c, i) =>
        c.type === 'rule'
          ? <RuleRow key={c.id} r={c} tf={tf} update={r => setChild(i, r)} remove={() => setChild(i, null)} />
          : <GroupEditor key={c.id} g={c} tf={tf} depth={depth + 1} update={n => setChild(i, n)} remove={() => setChild(i, null)} />,
      )}
      {g.children.length === 0 && <p className="px-1 text-xs text-mute">No conditions. An empty group passes every stock.</p>}
      <div className="flex gap-2 pt-1">
        <button className="btn btn-sm" onClick={() => update({ ...g, children: [...g.children, newRule()] })}>+ Condition</button>
        {depth < 3 && <button className="btn btn-sm" onClick={() => update({ ...g, children: [...g.children, newGroup(g.mode === 'ALL' ? 'ANY' : 'ALL', [newRule()])] })}>+ Group</button>}
      </div>
    </div>
  )
}

export function ScannerBuilder({ initial, sectors, onSave, onCancel, isNew }: { initial: ScannerConfig; sectors: string[]; onSave: (s: ScannerConfig) => void; onCancel: () => void; isNew: boolean }) {
  const [draft, setDraft] = useState<ScannerConfig>(initial)
  const error = useMemo(() => (draft.name.trim() ? validateTree(draft.root, draft.timeframe) : 'Name your scanner'), [draft])
  const num = (v: string) => (v === '' ? null : Number(v))
  const setRoot = (root: Group) => setDraft({ ...draft, root })
  const toggleSector = (s: string) => setDraft({ ...draft, universe: { ...draft.universe, sectors: draft.universe.sectors.includes(s) ? draft.universe.sectors.filter(x => x !== s) : [...draft.universe.sectors, s] } })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onCancel}>
      <div className="card flex max-h-[94dvh] w-full max-w-3xl flex-col !rounded-b-none sm:!rounded-b-2xl" onClick={e => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-line/70 px-5 py-4">
          <div><h2 className="text-lg font-semibold">{isNew ? 'New scanner' : 'Edit scanner'}</h2><p className="text-xs text-mute">Version {draft.version}{isNew ? '' : ` → ${draft.version + 1} on save`}</p></div>
          <button className="btn btn-ghost btn-sm" onClick={onCancel} aria-label="Close">✕</button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <label><span className="label">Name</span><input className="field mt-1" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
            <label><span className="label">Timeframe</span>
              <select className="field mt-1" value={draft.timeframe} onChange={e => setDraft({ ...draft, timeframe: e.target.value as ScannerConfig['timeframe'] })}>
                <option value="1D">Daily</option><option value="15m">15 min (needs intraday data)</option>
              </select>
            </label>
            <label className="sm:col-span-2"><span className="label">Description</span><input className="field mt-1" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
          </section>

          <section>
            <h3 className="mb-2 font-semibold">Conditions</h3>
            <GroupEditor g={draft.root} update={setRoot} tf={draft.timeframe} depth={0} />
            <p className="mt-2 text-xs text-mute">Missing data never passes a condition. Comparisons are type-checked (a price cannot be compared with RSI).</p>
          </section>

          <section>
            <h3 className="mb-2 font-semibold">Universe filters</h3>
            <div className="grid grid-cols-3 gap-3">
              <label><span className="label">Min price ₹</span><input className="field num mt-1" type="number" value={draft.universe.minPrice ?? ''} onChange={e => setDraft({ ...draft, universe: { ...draft.universe, minPrice: num(e.target.value) } })} /></label>
              <label><span className="label">Max price ₹</span><input className="field num mt-1" type="number" value={draft.universe.maxPrice ?? ''} onChange={e => setDraft({ ...draft, universe: { ...draft.universe, maxPrice: num(e.target.value) } })} /></label>
              <label><span className="label">Min traded ₹ Cr/day</span><input className="field num mt-1" type="number" value={draft.universe.minAvgTradedValueCr ?? ''} onChange={e => setDraft({ ...draft, universe: { ...draft.universe, minAvgTradedValueCr: num(e.target.value) } })} /></label>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {sectors.map(s => <button key={s} onClick={() => toggleSector(s)} className={`chip cursor-pointer ${draft.universe.sectors.includes(s) ? 'border-accent/60 bg-accent/10 text-accent' : ''}`}>{s}</button>)}
            </div>
            <p className="mt-1 text-xs text-mute">{draft.universe.sectors.length ? `${draft.universe.sectors.length} sector(s) selected` : 'All sectors'}</p>
          </section>

          <section>
            <h3 className="mb-1 font-semibold">Ranking weights</h3>
            <p className="mb-3 text-xs text-mute">Filtering and ranking are separate. Matches are ordered by this setup score. Weight 0 turns a factor off.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {([['trend', 'Trend alignment'], ['relStrength', 'Relative strength'], ['volume', 'Volume confirmation'], ['momentum', 'Momentum']] as const).map(([k, label]) => (
                <label key={k} className="block">
                  <div className="flex justify-between text-xs"><span>{label}</span><span className="num text-accent">{draft.ranking[k]}</span></div>
                  <input type="range" min={0} max={5} step={1} value={draft.ranking[k]} className="w-full accent-[var(--color-accent)]" onChange={e => setDraft({ ...draft, ranking: { ...draft.ranking, [k]: Number(e.target.value) } })} />
                </label>
              ))}
            </div>
          </section>
        </div>

        <footer className="flex items-center gap-3 border-t border-line/70 px-5 py-3.5">
          <p className={`min-w-0 flex-1 truncate text-xs ${error ? 'text-down' : 'text-up'}`}>{error ?? 'Ready to save'}</p>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" disabled={!!error} onClick={() => onSave({ ...draft, version: isNew ? draft.version : draft.version + 1 })}>Save scanner</button>
        </footer>
      </div>
    </div>
  )
}

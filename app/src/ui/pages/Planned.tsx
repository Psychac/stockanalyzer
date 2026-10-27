import { Empty, PageHeader } from '../components/bits'

export function Planned({ title, milestone, bullets }: { title: string; milestone: string; bullets: string[] }) {
  return (
    <>
      <PageHeader title={title} subtitle={`Planned for ${milestone} of the spec. Not part of this MVP.`} />
      <Empty icon="⏳" title="Coming later">
        <ul className="space-y-1 text-left">{bullets.map(b => <li key={b}>· {b}</li>)}</ul>
      </Empty>
    </>
  )
}

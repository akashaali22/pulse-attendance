export default function Loading() {
  return <div aria-busy="true" className="space-y-6">
    <div className="space-y-3"><div className="skeleton h-8 w-52" /><div className="skeleton h-4 w-72 max-w-full" /></div>
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="card space-y-4 p-5"><div className="skeleton h-3 w-24" /><div className="skeleton h-9 w-20" /><div className="skeleton h-3 w-32 max-w-full" /></div>)}</div>
    <div className="card space-y-5 p-5"><div className="skeleton h-8 w-48" />{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton h-10 w-full" />)}</div>
  </div>;
}

import Link from 'next/link';

export default function NotFound(): React.ReactElement {
  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-24 text-slate-100">
      <section className="mx-auto flex max-w-lg flex-col gap-5 rounded-xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">404</p>
        <h1 className="text-3xl font-bold">This GestureBridge page does not exist.</h1>
        <p className="text-sm leading-6 text-slate-300">
          Return to recognition, or sign in as an administrator to manage datasets and training.
        </p>
        <Link className="btn btn-primary w-fit" href="/">
          Open recognition
        </Link>
      </section>
    </main>
  );
}

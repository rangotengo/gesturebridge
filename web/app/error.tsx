'use client';

import { useEffect } from 'react';
import Link from 'next/link';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps): React.ReactElement {
  useEffect(() => {
    console.error('Unhandled route error:', error);
  }, [error]);

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-24 text-slate-100">
      <section className="mx-auto flex max-w-lg flex-col gap-5 rounded-xl border border-red-400/30 bg-red-950/20 p-6 shadow-2xl">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-red-300">Unexpected error</p>
          <h1 className="text-3xl font-bold">GestureBridge could not finish that request.</h1>
          <p className="text-sm leading-6 text-slate-300">
            Your camera and operating-system controls remain disabled until this page recovers.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn btn-primary" onClick={reset}>
            Try again
          </button>
          <Link className="btn btn-ghost" href="/">
            Return to recognition
          </Link>
        </div>
      </section>
    </main>
  );
}

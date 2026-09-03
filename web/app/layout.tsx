import type { Metadata } from 'next';
import '@/app/globals.css';
import Navbar from '@/components/Navbar';
import QueryProvider from '@/components/QueryProvider';
import { GestureProvider } from '@/context/GestureContext';

export const metadata: Metadata = {
  title: 'GestureBridge — Hand Gesture Recognition',
  description:
    'Real-time hand gesture recognition system for touchless computer interaction. Control your mouse with simple hand movements.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <html lang="en" className="font-sans antialiased" data-scroll-behavior="smooth">
      <body>
        <QueryProvider>
          <GestureProvider>
            {/* Navbar floats above all content; each page controls its own layout */}
            <Navbar />
            {children}
          </GestureProvider>
        </QueryProvider>
      </body>
    </html>
  );
}

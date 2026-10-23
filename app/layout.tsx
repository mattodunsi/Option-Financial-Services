import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Option Financial Services \u2014 Loan Assessment',
  description: 'Loan assessment and CAM for Option Financial Services'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import './globals.css';

export const metadata = {
  title: 'Feels Like Home',
  description: 'Compare the homes you like. Find the one that feels like home.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

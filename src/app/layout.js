import './globals.css';
import InstallPrompt from '@/components/InstallPrompt';

export const metadata = {
  title: 'Feels Like Home',
  description: 'Compare the homes you like. Find the one that feels like home.',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Feels Like Home',
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport = {
  themeColor: '#C1592F',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <InstallPrompt />
      </body>
    </html>
  );
}

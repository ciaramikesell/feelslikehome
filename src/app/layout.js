import './globals.css';
import InstallPrompt from '@/components/InstallPrompt';
import DeepLinkBridge from '@/components/DeepLinkBridge';
import NativeShellFlagCheck from '@/components/NativeShellFlagCheck';
import { NATIVE_SHELL_FLAG_SCRIPT } from '@/lib/platform';

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
  viewportFit: 'cover',
};

export default function RootLayout({ children }) {
  return (
    // suppressHydrationWarning: the inline script below may add the native
    // flag attribute to <html> before React hydrates; that one attribute is
    // the only expected difference from the server HTML.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Runs before <body> is parsed so the first paint already knows it is
            inside the native shell. See NATIVE_SHELL_FLAG_SCRIPT in
            src/lib/platform.js. */}
        <script dangerouslySetInnerHTML={{ __html: NATIVE_SHELL_FLAG_SCRIPT }} />
      </head>
      <body>
        {children}
        <InstallPrompt />
        <DeepLinkBridge />
        <NativeShellFlagCheck />
      </body>
    </html>
  );
}

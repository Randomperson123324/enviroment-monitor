import { Noto_Serif_Thai, IBM_Plex_Mono } from 'next/font/google';
import { STORAGE } from '@/config/client';
import './globals.css';

/**
 * UI face. Noto Serif Thai carries Latin as well as Thai, so one family covers
 * both languages and the interface does not change character when the language
 * toggle flips. The variable stays named --font-sans: everything downstream asks
 * for "the UI font", and renaming it would touch every rule for no gain.
 */
const ui = Noto_Serif_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

/** Numeric instrument readouts (levels, clocks, stats) — mirrors StreeFlood. */
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata = {
  title: 'ENV Monitor — สุขภาพห้องของคุณ',
  description: 'ระบบดูแลสภาพแวดล้อมห้อง (Arduino UNO Q · DEPA AIoT)',
};

/** Runs before paint so the correct theme is stamped without a flash (key shared with useTheme via STORAGE). */
const themeBoot = `(function(){try{var s=localStorage.getItem(${JSON.stringify(STORAGE.theme)});var d=s?s==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.dataset.theme=d?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({ children }) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body className={`${ui.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}

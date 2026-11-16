import type { Metadata } from 'next';
import { JetBrains_Mono, Plus_Jakarta_Sans, Vazirmatn } from 'next/font/google';
import { Toaster } from 'sonner';
import './globals.css';

const vazirmatn = Vazirmatn({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-vazirmatn',
  display: 'swap',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-jakarta',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'پورتال پشتیبانی آنلاین و پیگیری درخواست‌ها',
  description:
    'انتخاب دپارتمان پشتیبانی، گفت‌وگوی آنلاین با دستیار هوشمند و کارشناس، و پیگیری رسمی تیکت‌ها',
  openGraph: {
    title: 'پورتال پشتیبانی آنلاین و پیگیری درخواست‌ها',
    description:
      'انتخاب دپارتمان پشتیبانی، گفت‌وگوی آنلاین با دستیار هوشمند و کارشناس، و پیگیری رسمی تیکت‌ها',
    type: 'website',
    locale: 'fa_IR',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'پورتال پشتیبانی آنلاین و پیگیری درخواست‌ها',
    description:
      'انتخاب دپارتمان پشتیبانی، گفت‌وگوی آنلاین با دستیار هوشمند و کارشناس، و پیگیری رسمی تیکت‌ها',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="fa"
      dir="rtl"
      className={`scroll-smooth ${vazirmatn.variable} ${plusJakarta.variable} ${jetbrainsMono.variable}`}
    >
      <body
        suppressHydrationWarning
        className="min-h-screen bg-slate-50 text-slate-900 font-[family-name:var(--font-vazirmatn),var(--font-jakarta),sans-serif] selection:bg-blue-100 selection:text-blue-900"
      >
        {children}
        <Toaster dir="rtl" position="bottom-left" richColors closeButton />
      </body>
    </html>
  );
}

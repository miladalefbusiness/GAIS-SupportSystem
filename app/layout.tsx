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
  title: 'سامانه پشتیبانی هوشمند و مخزن فایل سازمانی',
  description:
    'پلتفرم یکپارچه میز پشتیبانی هوشمند سازمانی، پاسخگویی مبتنی بر مخزن دانش و اشتراک‌گذاری امن فایل',
  openGraph: {
    title: 'سامانه پشتیبانی هوشمند و مخزن فایل سازمانی',
    description:
      'پلتفرم یکپارچه میز پشتیبانی هوشمند سازمانی، پاسخگویی مبتنی بر مخزن دانش و اشتراک‌گذاری امن فایل',
    type: 'website',
    locale: 'fa_IR',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'سامانه پشتیبانی هوشمند و مخزن فایل سازمانی',
    description:
      'پلتفرم یکپارچه میز پشتیبانی هوشمند سازمانی، پاسخگویی مبتنی بر مخزن دانش و اشتراک‌گذاری امن فایل',
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
      className={`${vazirmatn.variable} ${plusJakarta.variable} ${jetbrainsMono.variable}`}
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

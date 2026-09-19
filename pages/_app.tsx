import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`appRoot ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}>
      <Component {...pageProps} />
    </div>
  );
}

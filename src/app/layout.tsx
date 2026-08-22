import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
	subsets: ["latin"],
	variable: "--font-display",
	display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
	subsets: ["latin"],
	variable: "--font-jetbrains",
	display: "swap",
});

export const metadata: Metadata = {
	title: "Trading Suite — IDX Desk | IHSG, Portfolio, Screener & Sentiment",
	description:
		"Dark desk for the IDX — IHSG overview, candlestick charts, FIFO portfolio, backtests, bandarmology validator, sentiment radar and live screener.",
	openGraph: {
		title: "Trading Suite — IDX Desk",
		description:
			"Eight tools across markets, portfolio, screening and sentiment — one dark desk for the IDX.",
		type: "website",
	},
	icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
	children,
}: Readonly<{ children: React.ReactNode }>) {
	return (
		<html
			lang="en"
			className={`dark ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
		>
			<body>{children}</body>
		</html>
	);
}

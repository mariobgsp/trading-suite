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
	title: "Trading Suite — IDX Platform",
	description:
		"Merged Indonesian stock trading platform: portfolio, backtesting, screener, bandarmology validator, sentiment radar, market regime.",
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

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	async redirects() {
		return [
			// sunset pages → nearest survivor (backend /api/* stays)
			{ source: "/suspended", destination: "/screener", permanent: false },
			{ source: "/suspended/:path*", destination: "/screener", permanent: false },
			{ source: "/foreignflow", destination: "/markets", permanent: false },
			{ source: "/foreignflow/:path*", destination: "/markets", permanent: false },
			{ source: "/brokerintel", destination: "/profiler", permanent: false },
			{
				source: "/brokerintel/:path*",
				destination: "/profiler",
				permanent: false,
			},
			{ source: "/validator", destination: "/profiler", permanent: false },
			{ source: "/validator/:path*", destination: "/profiler", permanent: false },
			{ source: "/alerts", destination: "/screener", permanent: false },
			{ source: "/alerts/:path*", destination: "/screener", permanent: false },
			{ source: "/konglo", destination: "/overview", permanent: false },
			{ source: "/konglo/:path*", destination: "/overview", permanent: false },
			{ source: "/rotation", destination: "/markets", permanent: false },
			{ source: "/rotation/:path*", destination: "/markets", permanent: false },
			{ source: "/ownership", destination: "/profiler", permanent: false },
			{ source: "/ownership/:path*", destination: "/profiler", permanent: false },
			{ source: "/msci", destination: "/overview", permanent: false },
			{ source: "/msci/:path*", destination: "/overview", permanent: false },
			{ source: "/announcements", destination: "/overview", permanent: false },
			{
				source: "/announcements/:path*",
				destination: "/overview",
				permanent: false,
			},
			{ source: "/regime", destination: "/overview", permanent: false },
			{ source: "/regime/:path*", destination: "/overview", permanent: false },
			{ source: "/backtest", destination: "/profiler", permanent: false },
			{ source: "/backtest/:path*", destination: "/profiler", permanent: false },
			{ source: "/sentiment", destination: "/overview", permanent: false },
			{ source: "/sentiment/:path*", destination: "/overview", permanent: false },
			{ source: "/watchlist", destination: "/overview", permanent: false },
			{ source: "/watchlist/:path*", destination: "/overview", permanent: false },
			{ source: "/journal", destination: "/profiler", permanent: false },
			{ source: "/journal/:path*", destination: "/profiler", permanent: false },
			{ source: "/stealth", destination: "/screener", permanent: false },
			{ source: "/stealth/:path*", destination: "/screener", permanent: false },
			{ source: "/wiki", destination: "/calculators", permanent: false },
			{ source: "/wiki/:path*", destination: "/calculators", permanent: false },
			{ source: "/portfolio", destination: "/profiler", permanent: false },
			{ source: "/portfolio/:path*", destination: "/profiler", permanent: false },
		];
	},
};

export default nextConfig;

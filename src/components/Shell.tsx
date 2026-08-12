"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";

export default function Shell({ children }: { children: React.ReactNode }) {
	const pathname = usePathname();
	const active = pathname === "/" ? "/" : `/${pathname.split("/")[1]}`;

	return (
		<div className="flex h-screen overflow-hidden bg-[var(--bg)]">
			<Sidebar active={active} />
			<main className="flex-1 overflow-y-auto">
				<div className="mx-auto max-w-[1400px] px-6 py-6">{children}</div>
			</main>
		</div>
	);
}

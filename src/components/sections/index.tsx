import { SECTIONS } from "@/lib/sections";
import { CalculatorsSection } from "./calculators";
import { MarketsSection } from "./markets";
import { OverviewSection } from "./overview";
import { ProfilerSection } from "./profiler";
import { ScreenerSection } from "./screener";

const BODIES = {
	overview: OverviewSection,
	markets: MarketsSection,
	screener: ScreenerSection,
	profiler: ProfilerSection,
	calculators: CalculatorsSection,
} as const;

/** The page body: every desk, stacked in reading order. */
export function SectionBodies() {
	return SECTIONS.map(({ id }) => {
		const Section = BODIES[id];
		return (
			<section
				key={id}
				id={id}
				className="scroll-mt-16 border-t border-[var(--border)] py-10 sm:py-12 lg:py-14"
			>
				<Section />
			</section>
		);
	});
}

import Shell from "@/components/Shell";
import { AppsGrid } from "@/components/launcher";
import { APPS } from "@/lib/apps";

export default function LauncherPage() {
	return (
		<Shell>
			<AppsGrid apps={APPS} />
		</Shell>
	);
}

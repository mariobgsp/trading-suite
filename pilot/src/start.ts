import { createStart } from "@tanstack/react-start";

/**
 * Global Start config — request middleware runs on every SSR request.
 * (Optional in this pilot; kept minimal per the react-start skill.)
 */
export const startInstance = createStart(() => ({}));

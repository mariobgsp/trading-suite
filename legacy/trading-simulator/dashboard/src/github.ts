/**
 * Local file storage — reads/writes JSON files via the Vite dev-server API.
 * No GitHub token required. Files are stored in the project root
 * (same files the engine.py reads).
 */

/** Read a JSON file from the project root. */
export async function readLocalFile<T>(filename: string): Promise<T> {
  const r = await fetch(`/api/files/${encodeURIComponent(filename)}?t=${Date.now()}`);
  if (!r.ok) throw new Error(`Failed to read ${filename}: ${r.status}`);
  return r.json() as Promise<T>;
}

/** Write a JSON file to the project root. */
export async function writeLocalFile<T>(filename: string, data: T): Promise<void> {
  const r = await fetch(`/api/files/${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error(`Failed to write ${filename}: ${r.status}`);
}

/* refresh.js — the "Perbarui data" header button.
 * Port of frontend-web/src/components/RefreshButton.tsx: one backend job,
 * poll its status, then tell every reader to re-read via the
 * "plan:refreshed" DOM event (port of lib/refresh.ts signalRefreshDone).
 */
"use strict";

import { api } from "./api.js";

export const REFRESH_EVENT = "plan:refreshed";

export function signalRefreshDone() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REFRESH_EVENT));
}

const POLL_MS = 1_200;
const MAX_POLL_MS = 25 * 60_000;

function fmtLabel(job, running) {
  if (running && job && job.names_total > 0) {
    return `Memperbarui ${job.names_checked}/${job.names_total}`;
  }
  if (running) return "memulai…";
  if (job && job.state === "done") return `selesai · ${job.session_after ?? ""}`;
  return "Perbarui data";
}

/** Wire every [data-refresh] cluster on the page. */
export function initRefresh() {
  document.querySelectorAll("[data-refresh]").forEach((root) => {
    const btn = root.querySelector("[data-refresh-btn]");
    const bar = root.querySelector("[data-refresh-bar]");
    const stopBtn = root.querySelector("[data-refresh-stop]");
    const flag = root.querySelector("[data-refresh-flag]");
    const err = root.querySelector("[data-refresh-err]");
    if (!btn) return;

    let job = null;
    let stopped = false;
    let startedAt = 0;

    const paint = () => {
      const running = job && job.state === "running";
      btn.disabled = !!running;
      btn.innerHTML = "";
      const dots = document.createTextNode(running ? "⋯ " : "⟳ ");
      btn.append(dots, document.createTextNode(fmtLabel(job, running)));
      if (bar) {
        const pct =
          running && job && job.names_total > 0
            ? Math.min(100, (job.names_checked / job.names_total) * 100)
            : 0;
        bar.style.width = `${pct}%`;
      }
      if (stopBtn) stopBtn.hidden = !running;
      if (flag) {
        if (!running && job && job.degraded) {
          flag.hidden = false;
          flag.textContent = `${job.names_failed} gagal`;
          flag.title =
            `${job.names_failed} dari ${job.names_total} saham tidak bisa diperbarui: ` +
            `${(job.failed_sample || []).join(", ")}`;
        } else {
          flag.hidden = true;
        }
      }
    };

    const showError = (message) => {
      if (!err) return;
      err.hidden = false;
      err.textContent = "gagal memperbarui";
      err.title = message;
    };

    async function poll(id) {
      while (!stopped) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (stopped) return;
        if (Date.now() - startedAt > MAX_POLL_MS) {
          showError("the refresh did not finish in time");
          return;
        }
        try {
          job = await api.get(`/api/plan/refresh/${id}`);
          paint();
          if (job.state === "running") continue;
          if (job.state === "done") {
            api.invalidate("/api/plan");
            signalRefreshDone();
          }
          return;
        } catch (e) {
          showError(e instanceof Error ? e.message : "the refresh stopped answering");
          return;
        }
      }
    }

    btn.addEventListener("click", async () => {
      if (err) err.hidden = true;
      try {
        job = await api.post("/api/plan/refresh", {});
        startedAt = Date.now();
        stopped = false;
        paint();
        if (job.state === "running") void poll(job.id);
        else if (job.state === "done") {
          api.invalidate("/api/plan");
          signalRefreshDone();
        }
      } catch (e) {
        showError(e instanceof Error ? e.message : "could not start the refresh");
      }
    });

    if (stopBtn) {
      stopBtn.addEventListener("click", async () => {
        if (!job) return;
        try {
          await api.post(`/api/plan/refresh/${job.id}/cancel`, {});
        } catch {
          /* the poll loop exits on its own */
        }
      });
    }

    window.addEventListener("pagehide", () => {
      stopped = true;
    });
    paint();
  });
}

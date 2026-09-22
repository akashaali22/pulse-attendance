// Runs once when the server starts, before any request touches the database.
// The nodejs check must wrap the imports (not early-return), so the edge build never pulls them in.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Hosts without a persistent disk: pull the newest database snapshot back in first.
    const { backupEnabled, installShutdownHook, restoreFromBackup, scheduleBackup } = await import("./lib/backup");
    if (backupEnabled()) {
      await restoreFromBackup();
      const { setOnWrite } = await import("./lib/db");
      setOnWrite(scheduleBackup);
      installShutdownHook();
    }
    const { startJobs } = await import("./lib/jobs");
    startJobs();
  }
}

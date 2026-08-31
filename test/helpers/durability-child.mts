/**
 * Child process for the hard-stop durability test: boots the REAL app on an
 * ephemeral port over the data dir given in env, prints PORT=<n>, and serves
 * until SIGKILLed by the parent. No cleanup handlers on purpose — the whole
 * point is dying without them.
 */
const { createApp, ensureDatabase } = await import("../../src/server/app");

await ensureDatabase();
const server = createApp().listen(0, () => {
  const addr = server.address();
  if (addr && typeof addr === "object") {
    console.log(`PORT=${addr.port}`);
  } else {
    console.error("no address");
    process.exit(1);
  }
});

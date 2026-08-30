import { chromium, devices } from "playwright";

const url = "http://127.0.0.1:3566/";

async function checkDesktop() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  const hasCanvas = await page.$("canvas");
  const chipCount = await page.$$eval("[data-chip]", (els) => els.length);
  const phaseCount = await page.$$eval("[data-phase]", (els) => els.length);
  console.log("desktop: canvas =", !!hasCanvas, "chips =", chipCount, "(expect 6) phases =", phaseCount, "(expect 3)");

  const sample = async () => page.evaluate(() => {
    const c = document.querySelector("canvas");
    if (!c) return null;
    const ctx = c.getContext("2d");
    return Array.from(ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data);
  });

  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(500);
  const s1 = await sample();
  const chipXform1 = await page.$eval('[data-chip]', (el) => el.style.transform);

  await page.mouse.wheel(0, 1600);
  await page.waitForTimeout(500);
  const s2 = await sample();
  const chipXform2 = await page.$eval('[data-chip]', (el) => el.style.transform);

  console.log("canvas frame changed with scroll =", JSON.stringify(s1) !== JSON.stringify(s2));
  console.log("chip transform changed with scroll =", chipXform1 !== chipXform2, chipXform1, "->", chipXform2);
  console.log("errors:", errors.length ? errors.slice(0, 5) : "none");

  await page.screenshot({ path: "/tmp/kundli-hero-ported-1.png" });
  await page.mouse.wheel(0, 1200);
  await page.waitForTimeout(500);
  await page.screenshot({ path: "/tmp/kundli-hero-ported-2.png" });
  await browser.close();
}

async function checkMobile() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ ...devices["iPhone 13"] });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const hasCanvas = await page.$("canvas");
  const hasVideo = await page.$("video");
  console.log("mobile: canvas =", !!hasCanvas, "(expect false) video =", !!hasVideo, "(expect true)");
  console.log("mobile errors:", errors.length ? errors : "none");
  await page.screenshot({ path: "/tmp/kundli-hero-mobile-ported.png" });
  await browser.close();
}

await checkDesktop();
await checkMobile();

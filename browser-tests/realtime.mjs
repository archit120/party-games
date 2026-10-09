const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  for (const [game, port, button] of [
    ["secret-hitler", 3400, "Create room"],
    ["coup", 3401, "Enter the court"],
    ["undercover", 3402, "Enter the room"],
  ]) {
    const base =
      process.env[game.toUpperCase().replaceAll("-", "_") + "_URL"] ||
      `http://127.0.0.1:${port}`;
    const page = await browser.newPage();
    let frames = 0,
      polls = 0;
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("websocket", (ws) => ws.on("framereceived", () => frames++));
    page.on("request", (r) => {
      if (r.method() === "GET" && /\/api\/(state|rooms\/)/.test(r.url()))
        polls++;
    });
    await page.goto(base);
    // Use the existing UI's create form for each app.
    await page.locator("[name=name], #name").fill("Socket Host");
    const buttons = await page.locator("button").allTextContents();
    const create =
      game === "secret-hitler"
        ? buttons.find((s) => /create/i.test(s))
        : button;
    await page.getByRole("button", { name: create, exact: true }).click();
    await page.waitForFunction(() => location.search.includes("room="));
    await page.waitForTimeout(1800);
    assert.ok(frames > 0, game + " WebSocket snapshot");
    const code = new URL(page.url()).searchParams.get("room");
    async function join(name) {
      const r = await fetch(`${base}/api/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, name }),
      });
      assert.equal(r.status, 200);
    }
    const before = frames;
    await join("Socket Guest");
    await page
      .getByText("Socket Guest", { exact: false })
      .first()
      .waitFor({ timeout: 3000 });
    assert.ok(frames > before, game + " pushed join");
    const count = polls;
    await page.waitForTimeout(2200);
    assert.equal(polls, count, game + " polls slowed");
    // Make subsequent socket construction fail, close the current socket by reload,
    // and prove the existing HTTP path continues updating the UI.
    await page.addInitScript(() => {
      window.WebSocket = class {
        constructor() {
          throw Error("simulated unavailable socket");
        }
      };
    });
    await page.reload();
    await join("Polling Guest");
    await page
      .getByText("Polling Guest", { exact: false })
      .first()
      .waitFor({ timeout: 5000 });
    assert.deepEqual(errors, []);
    console.log("PASS", game, "push, reduced polling, polling fallback");
    await page.close();
  }
} finally {
  await browser.close();
}

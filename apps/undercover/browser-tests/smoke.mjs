const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import assert from "node:assert/strict";
const base = process.env.CHECK_URL || "http://127.0.0.1:3102",
  browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
try {
  const pages = [],
    errors = [];
  const host = await browser.newPage({ viewport: { width: 390, height: 844 } });
  pages.push(host);
  host.on("pageerror", (e) => errors.push(e.message));
  await host.goto(base);
  console.log((await host.locator("body").innerText()).slice(0, 120));
  await host.locator("[name=name]").fill("Host");
  await host
    .getByRole("button", { name: "Enter the room", exact: true })
    .click();
  await host.getByRole("heading", { name: "Gather your suspects" }).waitFor();
  const url = host.url();
  for (let i = 1; i < 5; i++) {
    const p = await browser.newPage();
    pages.push(p);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(url);
    await p.locator("[name=name]").fill("Player " + i);
    await p.getByRole("button", { name: "Join room", exact: true }).click();
    await p.getByRole("heading", { name: "Gather your suspects" }).waitFor();
  }
  await host.locator(".person").filter({ hasText: "Player 4" }).waitFor();
  await host.locator("[name=mrWhite]").check();
  await Promise.all([
    host.waitForResponse(
      (r) =>
        r.url().endsWith("/action") &&
        r.request().postDataJSON()?.type === "settings",
    ),
    host.getByRole("button", { name: "Save settings", exact: true }).click(),
  ]);
  await host.getByRole("button", { name: "Begin game", exact: true }).click();
  await host.locator("#secret-toggle").waitFor();
  assert.match(
    await host.locator(".secret h2").innerText(),
    /Keep it under cover/,
  );
  await host.locator("#secret-toggle").click();
  assert.ok((await host.locator(".secret h2").innerText()).length > 0);
  await host.reload();
  await host.locator("#secret-toggle").waitFor();
  assert.match(
    await host.locator(".secret h2").innerText(),
    /Keep it under cover/,
  );
  const sessions = [];
  for (const p of pages) {
    await p.locator("#secret-toggle").waitFor();
    sessions.push(
      await p.evaluate(
        () =>
          Object.values(
            JSON.parse(localStorage.getItem("undercover-seats")),
          )[0],
      ),
    );
  }
  async function state() {
    const r = await fetch(base + "/api/rooms/" + sessions[0].code, {
      headers: { Authorization: "Bearer " + sessions[0].token },
    });
    return r.json();
  }
  for (let i = 0; i < 5; i++) {
    const s = await state();
    let current;
    for (let j = 0; j < sessions.length; j++) {
      const r = await fetch(base + "/api/rooms/" + sessions[j].code, {
        headers: { Authorization: "Bearer " + sessions[j].token },
      });
      if ((await r.json()).me.id === s.turn) {
        current = pages[j];
        break;
      }
    }
    await current.locator("#clue-text").waitFor();
    await current.locator("#clue-text").fill("Clue " + i);
    await current
      .getByRole("button", { name: "Share clue", exact: true })
      .click();
    await current.waitForFunction(() => !document.querySelector("#clue-text"));
  }
  await host.getByRole("button", { name: "Open voting", exact: true }).click();
  for (const p of pages) {
    await p.locator(".ballot button").first().waitFor();
    await p.locator(".ballot button").first().click();
  }
  await host.waitForFunction(
    () =>
      !document
        .querySelector(".decision h2")
        ?.textContent.includes("Who is undercover"),
  );
  assert.equal(
    await host.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await host.screenshot({ path: "/tmp/undercover-mobile.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: five separate devices, Mr White setting, private reveal/hide, reload recovery, clue turns, voting, mobile layout. " +
      url,
  );
} finally {
  await browser.close();
}

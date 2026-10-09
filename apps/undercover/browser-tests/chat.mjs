const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import assert from "node:assert/strict";
const base = process.env.CHECK_URL || "http://127.0.0.1:3302";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const p = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(base);
  await p.locator("[name=name]").fill("Chat check");
  await p.getByRole("button", { name: "Enter the room", exact: true }).click();
  for (const name of ["Ada", "Basil"]) {
    await p.getByRole("button", { name: "Add AI player", exact: true }).click();
    await p.locator(".person").filter({ hasText: name }).waitFor();
  }
  await p.locator("#chat-text").fill("Ada, say hello to the table.");
  await p.getByRole("button", { name: "Send message", exact: true }).click();
  await p
    .locator("#messages article")
    .filter({ hasText: "Ada, say hello" })
    .waitFor();
  await p.locator("#chat-text").fill("Draft survives polling");
  await p.locator("#messages .ai-label").first().waitFor({ timeout: 60000 });
  assert.equal(
    await p.locator("#chat-text").inputValue(),
    "Draft survives polling",
  );
  assert.equal(
    await p.locator("#chat-text").evaluate((e) => document.activeElement === e),
    true,
  );
  await p.locator("#chat-text").fill("");
  await p.getByRole("button", { name: "Begin game", exact: true }).click();
  await p.locator("#clue-text").waitFor({ timeout: 60000 });
  assert.equal(await p.locator("#chat-text").isDisabled(), true);
  await p.locator("#clue-text").fill("association");
  await p.getByRole("button", { name: "Share clue", exact: true }).click();
  await p
    .getByRole("button", { name: "Open voting", exact: true })
    .waitFor({ timeout: 60000 });
  await p.locator("#messages .ai-label").first().waitFor({ timeout: 60000 });
  await p
    .locator("#chat-text")
    .fill("Ada, which clue seems least convincing, and why?");
  await p.getByRole("button", { name: "Send message", exact: true }).click();
  await p.waitForFunction(
    () =>
      [...document.querySelectorAll("#messages article")].some(
        (el, i, all) =>
          el.textContent.includes("which clue seems") &&
          all
            .slice(i + 1)
            .some((x) => x.querySelector("b")?.textContent.includes("Ada")),
      ),
    {},
    { timeout: 60000 },
  );
  assert.equal(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await p.screenshot({
    path: "/tmp/undercover-chat-mobile.png",
    fullPage: true,
  });
  await p.reload();
  await p
    .locator("#messages article")
    .filter({ hasText: "which clue seems" })
    .waitFor();
  await p.getByRole("button", { name: "Open voting", exact: true }).click();
  await p.waitForFunction(
    () => document.querySelector("#chat-text")?.disabled === true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: lobby AI reply, public round discussion, named AI reply, draft/focus retention, refresh persistence, voting chat gate, mobile layout. " +
      p.url(),
  );
} finally {
  await browser.close();
}

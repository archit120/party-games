const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
import assert from "node:assert/strict";
const base = process.env.CHECK_URL || "http://127.0.0.1:3000";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const seats = [],
  errors = [];
async function create(name) {
  const r = await fetch(base + "/api/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  assert.equal(r.status, 200);
  const s = await r.json();
  seats.push(s);
  return s;
}
async function room(page, code) {
  await page.waitForURL(base + "/?room=" + code);
  await page.waitForFunction(
    (c) => document.querySelector(".room-ticket b")?.textContent === c,
    code,
  );
}
async function seat(page) {
  const s = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("assembly-session")),
  );
  seats.push(s);
  return s;
}
try {
  const a = await create("Old host"),
    b = await create("Target host");
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.evaluate(
    (s) => localStorage.setItem("assembly-session", JSON.stringify(s)),
    { code: a.code, token: a.token },
  );
  await page.goto(base + "/?room=" + b.code);
  await page.getByRole("heading", { name: "Join room " + b.code }).waitFor();
  assert.equal(await page.locator(".room-ticket").count(), 0);
  assert.equal(await page.locator('[data-resume="' + a.code + '"]').count(), 1);
  await page.screenshot({ path: "/tmp/sh-invite-fixed.png", fullPage: true });
  await page.getByLabel("YOUR NAME").fill("Invite keyboard guest");
  const submitted = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().includes("/api/"),
  );
  await page.getByLabel("YOUR NAME").press("Enter");
  assert.equal(new URL((await submitted).url()).pathname, "/api/join");
  await room(page, b.code);
  const guest = await seat(page);
  await page.reload();
  await room(page, b.code);
  const tab = await ctx.newPage();
  await tab.goto(base + "/?room=" + a.code);
  await room(tab, a.code);
  await page.reload();
  await room(page, b.code);
  await page.goto(base);
  await page.locator('[data-resume="' + a.code + '"]').click();
  await room(page, a.code);
  await page.goBack();
  await page.locator("#entry").waitFor();
  assert.equal(new URL(page.url()).search, "");
  await page.goto(base + "/?room=" + b.code.toLowerCase());
  await page.waitForFunction(
    (c) => document.querySelector(".room-ticket b")?.textContent === c,
    b.code,
  );
  await page.getByRole("button", { name: "Leave room", exact: true }).click();
  await page.waitForURL(base + "/");
  await page.goto(base + "/?room=" + b.code);
  await page.getByRole("heading", { name: "Join room " + b.code }).waitFor();
  await page.getByLabel("YOUR NAME").fill("Invite button guest");
  await page
    .getByRole("button", { name: "Join room " + b.code + " →", exact: true })
    .click();
  await room(page, b.code);
  await seat(page);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  const fresh = await browser.newContext();
  const manual = await fresh.newPage();
  manual.on("pageerror", (e) => errors.push(e.message));
  await manual.goto(base);
  await manual.getByLabel("YOUR NAME").fill("Manual enter guest");
  await manual.getByLabel("ROOM CODE").fill(b.code);
  await manual.getByLabel("ROOM CODE").press("Enter");
  await room(manual, b.code);
  await seat(manual);
  await manual.goto(base);
  await manual.getByLabel("YOUR NAME").fill("New room host");
  await manual.getByRole("button", { name: "Create a private room" }).click();
  await manual.locator(".room-ticket b").waitFor();
  const created = await seat(manual);
  await room(manual, created.code);
  assert.notEqual(created.code, b.code);
  await manual.goto(base + "/?room=BAD");
  await manual.getByText("This invite is invalid.", { exact: false }).waitFor();
  assert.equal(await manual.locator("button[type=submit]").isDisabled(), true);
  await manual.goto(base + "/?room=ZZZZZZ");
  await manual.getByLabel("YOUR NAME").fill("Expired invite");
  const req = manual.waitForRequest((r) => r.method() === "POST");
  await manual.getByLabel("YOUR NAME").press("Enter");
  assert.equal(new URL((await req).url()).pathname, "/api/join");
  await manual
    .locator("#error")
    .filter({ hasText: "Room unavailable" })
    .waitFor();
  assert.equal(new URL(manual.url()).searchParams.get("room"), "ZZZZZZ");
  // A stale token must retain the invite instead of redirecting to create.
  await manual.evaluate((code) => {
    const s = JSON.parse(localStorage.getItem("assembly-saved-seats")) || {};
    s[code] = { code, token: "expired" };
    localStorage.setItem("assembly-saved-seats", JSON.stringify(s));
  }, b.code);
  await manual.goto(base + "/?room=" + b.code);
  await manual.getByRole("heading", { name: "Join room " + b.code }).waitFor();
  assert.equal(new URL(manual.url()).searchParams.get("room"), b.code);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: invite overrides legacy session; Enter and button join; manual-code Enter joins; create sets URL; refresh and separate tabs keep correct seats; homepage/resume/back; lowercase invites; leave frees seat; invalid/expired invites do not create; stale auth retains invite; no mobile overflow or JS errors.",
  );
} finally {
  await browser.close();
  for (const s of seats)
    await fetch(base + "/api/rooms/" + s.code + "/leave", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + s.token,
        "Content-Type": "application/json",
      },
      body: "{}",
    }).catch(() => {});
}

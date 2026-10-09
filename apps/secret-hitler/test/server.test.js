import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
test("HTTP authentication, lobby leave/host transfer, active-game protection, private views, and persistence", async () => {
  const data = await mkdtemp(join(tmpdir(), "assembly-test-"));
  let child, base;
  async function start() {
    child = spawn(process.execPath, ["server.js"], {
      env: { ...process.env, PORT: "0", DATA_DIR: data },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const [buf] = await once(child.stdout, "data");
    base = `http://127.0.0.1:${String(buf).match(/listening on (\d+)/)[1]}`;
  }
  async function stop() {
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  async function request(path, body, token) {
    const r = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, body: await r.json() };
  }
  try {
    await start();
    let { body: host } = await request("/api/create", { name: "Host" });
    const path = `/api/rooms/${host.code}`;
    assert.equal((await request(path)).status, 401);
    let players = [host];
    for (let i = 1; i < 5; i++)
      players.push(
        (await request("/api/join", { code: host.code, name: `Player ${i}` }))
          .body,
      );
    assert.equal((await request(path + "/leave", {})).status, 401);
    const formerHost = host;
    assert.equal((await request(path + "/leave", {}, host.token)).status, 200);
    host = players[1];
    let afterLeave = (await request(path, null, host.token)).body;
    assert.equal(afterLeave.players.length, 4);
    assert.equal(afterLeave.host, host.state.me.id);
    assert.equal((await request(path, null, formerHost.token)).status, 401);
    assert.equal(
      (await request("/api/join", { code: host.code, name: "Host" })).status,
      200,
    );
    const solo = (await request("/api/create", { name: "Solo" })).body;
    assert.equal(
      (await request(`/api/rooms/${solo.code}/leave`, {}, solo.token)).status,
      200,
    );
    assert.equal(
      (await request("/api/join", { code: solo.code, name: "New" })).status,
      400,
    );
    let state = (await request(path, null, host.token)).body;
    let started = await request(
      path + "/action",
      { type: "start", revision: state.revision, payload: {} },
      host.token,
    );
    assert.equal(started.status, 200);
    assert.equal(started.body.phase, "nominate");
    assert.equal((await request(path + "/leave", {}, host.token)).status, 409);
    assert.ok(started.body.players.every((p) => !p.role && !p.token));
    assert.equal(started.body.deck, undefined);
    assert.equal(
      (
        await request(
          path + "/action",
          { type: "start", revision: state.revision, payload: {} },
          host.token,
        )
      ).status,
      409,
    );
    await stop();
    await start();
    const recovered = await request(path, null, host.token);
    assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.body, started.body);
    assert.equal(
      (await request("/api/join", { code: host.code, name: "Late" })).status,
      400,
    );
    // Every ballot intentionally uses the same pre-vote revision.
    const voteHost = (await request("/api/create", { name: "Vote host" })).body;
    const voters = [voteHost];
    for (let i = 1; i < 10; i++)
      voters.push(
        (
          await request("/api/join", {
            code: voteHost.code,
            name: `Voter ${i}`,
          })
        ).body,
      );
    const votePath = `/api/rooms/${voteHost.code}`;
    let election = (await request(votePath, null, voteHost.token)).body;
    election = (
      await request(
        votePath + "/action",
        { type: "start", revision: election.revision, payload: {} },
        voteHost.token,
      )
    ).body;
    const president = voters.find((v) => v.state.me.id === election.president);
    election = (
      await request(
        votePath + "/action",
        {
          type: "nominate",
          revision: election.revision,
          payload: { target: election.eligible[0] },
        },
        president.token,
      )
    ).body;
    const ballot = {
      type: "vote",
      revision: election.revision,
      electionId: election.electionId,
      payload: { yes: true },
    };
    const first = await request(votePath + "/action", ballot, voteHost.token);
    const repeated = await request(
      votePath + "/action",
      { ...ballot, payload: { yes: false } },
      voteHost.token,
    );
    assert.equal(first.status, 200);
    assert.equal(repeated.status, 200);
    assert.equal(repeated.body.revision, first.body.revision);
    assert.equal(
      (
        await request(
          votePath + "/action",
          { ...ballot, electionId: election.electionId - 1 },
          voters[1].token,
        )
      ).status,
      409,
    );
    const chat = await request(
      votePath + "/chat",
      { text: "I support this government." },
      voteHost.token,
    );
    assert.equal(chat.status, 200);
    const legacyBallot = {
      type: ballot.type,
      revision: ballot.revision,
      payload: ballot.payload,
    };
    const results = await Promise.all(
      voters
        .slice(1)
        .map((v, i) =>
          request(
            votePath + "/action",
            i === 0 ? legacyBallot : ballot,
            v.token,
          ),
        ),
    );
    assert.ok(
      results.every((r) => r.status === 200),
      JSON.stringify(results.map((r) => r.status)),
    );
    const elected = (await request(votePath, null, voteHost.token)).body;
    assert.equal(elected.phase, "president-discard");
    assert.equal(Object.keys(elected.lastVote.votes).length, 10);
    assert.ok(Object.values(elected.lastVote.votes).every(Boolean));
  } finally {
    if (child && child.exitCode === null) await stop();
    await rm(data, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { signInitData, validateInitData, isAcceptedMembership } from "./validate.ts";

const TOKEN = "123456:FAKE_TEST_BOT_TOKEN";
const NOW = 1_800_000_000;

function baseEntries(overrides: Record<string, string> = {}) {
  return {
    auth_date: String(NOW),
    query_id: "AAF",
    user: JSON.stringify({ id: 42, first_name: "Alice", username: "alice" }),
    ...overrides,
  };
}

test("accepts valid initData", () => {
  const initData = signInitData(baseEntries(), TOKEN);
  const res = validateInitData(initData, TOKEN, { now: NOW });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.user?.id, 42);
    assert.equal(res.authDate, NOW);
  }
});

test("rejects tampered field", () => {
  const initData = signInitData(baseEntries(), TOKEN);
  const tampered = initData.replace("alice", "mallory");
  const res = validateInitData(tampered, TOKEN, { now: NOW });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "bad_hash");
});

test("rejects wrong bot token", () => {
  const initData = signInitData(baseEntries(), TOKEN);
  const res = validateInitData(initData, "999:OTHER_TOKEN", { now: NOW });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "bad_hash");
});

test("rejects stale auth_date (>5 min)", () => {
  const jauth = String(NOW - 301);
  const initData = signInitData(baseEntries({ auth_date: jauth }), TOKEN);
  const res = validateInitData(initData, TOKEN, { now: NOW });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "expired");
});

test("accepts auth_date within window (exactly 300s)", () => {
  const initData = signInitData(baseEntries({ auth_date: String(NOW - 300) }), TOKEN);
  const res = validateInitData(initData, TOKEN, { now: NOW, maxAgeSeconds: 300 });
  assert.equal(res.ok, true);
});

test("rejects missing hash", () => {
  const res = validateInitData("auth_date=1&user=%7B%7D", TOKEN, { now: NOW });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "missing_hash");
});

test("membership: creator/administrator/member accepted", () => {
  assert.equal(isAcceptedMembership({ status: "creator" }), true);
  assert.equal(isAcceptedMembership({ status: "administrator" }), true);
  assert.equal(isAcceptedMembership({ status: "member" }), true);
});

test("membership: restricted only when is_member true", () => {
  assert.equal(isAcceptedMembership({ status: "restricted", is_member: true }), true);
  assert.equal(isAcceptedMembership({ status: "restricted", is_member: false }), false);
});

test("membership: left/kicked rejected", () => {
  assert.equal(isAcceptedMembership({ status: "left" }), false);
  assert.equal(isAcceptedMembership({ status: "kicked" }), false);
});

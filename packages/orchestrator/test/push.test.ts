import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import {
  startPhase3Stack,
  connectPhone,
  apiRequest,
  sleep,
} from "../test/helpers.js";
import type { Phase3TestStack } from "../test/helpers.js";

describe("Push notifications", () => {
  let stack: Phase3TestStack;

  before(async () => {
    stack = await startPhase3Stack({
      workingIntervalMs: 200,
      disconnectGraceMs: 200,
    });
  });

  after(async () => {
    await stack.close();
  });

  it("POST /push/register stores an Expo push token via session store", async () => {
    stack.fakeExpoPush.reset();
    stack.deduplicator.reset();

    const res = await apiRequest(stack.baseUrl, "POST", "/push/register", {
      token: "ExponentPushToken[abc123]",
    });

    assert.strictEqual(res.status, 200);

    const tokens = await stack.store.getPushTokens();
    assert.ok(
      tokens.includes("ExponentPushToken[abc123]"),
      "Store should contain the registered push token",
    );
  });

  it("permission.created event triggers push to fake Expo server when no phone connected", async () => {
    stack.fakeExpoPush.reset();
    stack.deduplicator.reset();
    stack.store.clearPushTokens();

    await stack.store.savePushToken("ExponentPushToken[test]");

    stack.fakeOpenCode.pushEvent({
      type: "permission.created",
      properties: {
        sessionID: "sess1",
        permission: { id: "perm1", description: "run npm test" },
      },
    });

    await sleep(500);

    const notifications = stack.fakeExpoPush.notifications();
    assert.ok(
      notifications.length >= 1,
      `Expected at least 1 notification, got ${notifications.length}`,
    );

    const notif = notifications[0];
    assert.strictEqual(notif.to, "ExponentPushToken[test]");
    assert.strictEqual(notif.title, "Approval needed");
    assert.ok(
      notif.body.includes("run npm test"),
      `Expected body to contain "run npm test", got "${notif.body}"`,
    );
  });

  it("permission.created event does NOT trigger push when phone IS connected", async () => {
    stack.fakeExpoPush.reset();
    stack.deduplicator.reset();
    stack.store.clearPushTokens();

    await stack.store.savePushToken("ExponentPushToken[test]");

    const phone = await connectPhone(stack.orchestrator.port);

    stack.fakeOpenCode.pushEvent({
      type: "permission.created",
      properties: {
        sessionID: "sess1",
        permission: { id: "perm1", description: "run npm test" },
      },
    });

    await sleep(500);

    const notifications = stack.fakeExpoPush.notifications();
    assert.strictEqual(
      notifications.length,
      0,
      "No push should be sent when phone is connected",
    );

    phone.close();
    await sleep(100);
  });

  it("push payload includes permission description", async () => {
    stack.fakeExpoPush.reset();
    stack.deduplicator.reset();
    stack.store.clearPushTokens();

    await stack.store.savePushToken("ExponentPushToken[test]");

    stack.fakeOpenCode.pushEvent({
      type: "permission.created",
      properties: {
        sessionID: "sess1",
        permission: {
          id: "perm2",
          description: "execute shell command: rm -rf node_modules",
        },
      },
    });

    await sleep(500);

    const notifications = stack.fakeExpoPush.notifications();
    assert.ok(notifications.length >= 1, "Expected at least 1 notification");

    const notif = notifications[0];
    assert.ok(
      notif.body.includes("execute shell command"),
      `Expected body to contain "execute shell command", got "${notif.body}"`,
    );
  });

  it("rapid message.part.updated events are debounced", async () => {
    stack.fakeExpoPush.reset();
    stack.deduplicator.reset();
    stack.store.clearPushTokens();

    await stack.store.savePushToken("ExponentPushToken[test]");

    // Push all events as fast as possible — they should all arrive
    // within the 200ms working interval window
    for (let i = 0; i < 5; i++) {
      stack.fakeOpenCode.pushEvent({
        type: "message.part.updated",
        properties: {
          sessionID: "sess1",
          part: { id: `part${i}`, content: `chunk ${i}` },
        },
      });
    }

    // Wait long enough for all events to be processed but NOT long enough
    // for the dedup window to expire and allow a second push
    await sleep(100);

    const notifications = stack.fakeExpoPush.notifications();
    assert.ok(
      notifications.length <= 1,
      `Expected at most 1 debounced notification, got ${notifications.length}`,
    );
  });

  it("daemon disconnect triggers push after debounce grace period", async () => {
    stack.fakeExpoPush.reset();
    stack.deduplicator.reset();
    stack.store.clearPushTokens();

    await stack.store.savePushToken("ExponentPushToken[test]");

    await stack.relay.disconnect();

    await sleep(400);

    const notifications = stack.fakeExpoPush.notifications();
    assert.ok(notifications.length >= 1, "Expected a disconnect notification");

    const notif = notifications.find((n) => n.title === "Dev machine offline");
    assert.ok(notif, 'Expected notification with title "Dev machine offline"');

    // Reconnect so subsequent tests can use the relay
    await stack.relay.connect();
    await sleep(100);
  });

  it("daemon reconnect within grace period cancels the disconnect push", async () => {
    stack.fakeExpoPush.reset();
    stack.deduplicator.reset();
    stack.store.clearPushTokens();

    await stack.store.savePushToken("ExponentPushToken[test]");

    await stack.relay.disconnect();

    await sleep(50);

    await stack.relay.connect();
    await sleep(100);

    // Wait past what would have been the full grace period
    await sleep(300);

    const notifications = stack.fakeExpoPush.notifications();
    assert.strictEqual(
      notifications.length,
      0,
      "No push should be sent when daemon reconnects within grace period",
    );
  });
});

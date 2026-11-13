const assert = require("node:assert/strict");
const { test } = require("node:test");
const NotificationOutbox = require("../models/notificationOutbox");
const Notification = require("../models/notification");
const { enqueueOrderNotification } = require("../lib/orderNotifications");
const { AUDIT_EVENT_TYPES } = require("../models/auditEvent");

test("preorder notifications use the outbox with event-specific staff roles", async () => {
  const originalCreate = NotificationOutbox.create;
  const records = [];
  NotificationOutbox.create = async (record) => {
    records.push(record);
    return record;
  };
  try {
    const order = {
      _id: "507f1f77bcf86cd799439041",
      orderNumber: "ORD-2026-000001",
      promisedDate: "2026-11-20",
    };
    await enqueueOrderNotification({
      event: "preorder_confirmed",
      order,
      actorId: "507f1f77bcf86cd799439042",
    });
    await enqueueOrderNotification({ event: "preorder_review", order });
    assert.equal(records[0].eventKey, `order:${order._id}:preorder_confirmed`);
    assert.deepEqual(records[0].recipientRoles, ["General Manager"]);
    assert.equal(records[0].category, "orders");
    assert.deepEqual(records[1].recipientRoles, ["Sales Manager"]);
    assert.equal(records[1].resource.type, "order");
  } finally {
    NotificationOutbox.create = originalCreate;
  }
});

test("notification schemas accept the dedicated orders category", () => {
  assert.ok(Notification.schema.path("category").enumValues.includes("orders"));
  assert.ok(NotificationOutbox.schema.path("category").enumValues.includes("orders"));
  assert.ok(AUDIT_EVENT_TYPES.includes("order.preorder_promised"));
  assert.ok(AUDIT_EVENT_TYPES.includes("order.production_allocated"));
});

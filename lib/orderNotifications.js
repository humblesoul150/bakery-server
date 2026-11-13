const { enqueueNotificationEvent } = require("./notificationEvents");

const ORDER_NOTIFICATION_EVENTS = {
  preorder_review: {
    type: "order.preorder_review",
    category: "orders",
    severity: "action_required",
    title: "Preorder needs review",
    roles: ["Sales Manager"],
    message: (order) =>
      `Preorder ${order.orderNumber} is waiting for a promised-date and capacity decision.`,
  },
  preorder_confirmed: {
    type: "order.preorder_confirmed",
    category: "orders",
    severity: "action_required",
    title: "Preorder production demand accepted",
    roles: ["General Manager"],
    message: (order) =>
      `Preorder ${order.orderNumber} is confirmed for ${order.promisedDate}.`,
  },
  preorder_ready: {
    type: "order.preorder_ready",
    category: "orders",
    severity: "action_required",
    title: "Preorder is ready",
    roles: ["Sales Manager", "General Manager"],
    message: (order) =>
      `Preorder ${order.orderNumber} is fully allocated and ready for fulfillment.`,
  },
  preorder_cancelled: {
    type: "order.preorder_cancelled",
    category: "orders",
    severity: "info",
    title: "Preorder cancelled",
    roles: ["Sales Manager", "General Manager"],
    message: (order) => `Preorder ${order.orderNumber} was cancelled.`,
  },
};

async function enqueueOrderNotification({
  event,
  order,
  actorId,
  session,
}) {
  const definition = ORDER_NOTIFICATION_EVENTS[event];
  if (!definition) throw new TypeError("Unsupported order notification event.");
  await enqueueNotificationEvent(
    {
      eventKey: `order:${String(order._id)}:${event}`,
      type: definition.type,
      category: definition.category,
      severity: definition.severity,
      title: definition.title,
      message: definition.message(order),
      resource: {
        type: "order",
        id: String(order._id),
        reference: order.orderNumber,
      },
      recipientRoles: definition.roles,
      actorId: actorId ? String(actorId) : undefined,
      occurredAt: new Date(),
    },
    session,
  );
}

module.exports = { enqueueOrderNotification };

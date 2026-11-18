const { createHash } = require("node:crypto");
const FinishedStockLot = require("../models/finishedStockLot");
const FinishedStockLotMovement = require("../models/finishedStockLotMovement");

const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });

async function dispatchBakerySaleLots({
  variantId,
  quantity,
  date,
  reference,
  saleId,
  idempotencyKey,
  lineIndex,
  reason,
  actorId,
  session,
}) {
  const lots = await FinishedStockLot.find({
    variantId,
    status: "active",
    expiryDate: { $gte: date },
    $expr: { $gt: ["$remainingQuantity", "$reservedQuantity"] },
  })
    .sort({ expiryDate: 1, productionDate: 1, createdAt: 1, _id: 1 })
    .session(session);

  let remaining = quantity;
  const dispatched = [];
  for (const lot of lots) {
    if (!remaining) break;
    const available = lot.remainingQuantity - lot.reservedQuantity;
    const allocated = Math.min(available, remaining);
    if (allocated < 1) continue;

    const updated = await FinishedStockLot.findOneAndUpdate(
      {
        _id: lot._id,
        variantId,
        status: "active",
        remainingQuantity: lot.remainingQuantity,
        reservedQuantity: lot.reservedQuantity,
        expiryDate: { $gte: date },
        $expr: {
          $gte: [
            { $subtract: ["$remainingQuantity", "$reservedQuantity"] },
            allocated,
          ],
        },
      },
      {
        $inc: { remainingQuantity: -allocated },
        ...(lot.remainingQuantity === allocated && lot.reservedQuantity === 0
          ? { $set: { status: "depleted" } }
          : {}),
      },
      { new: true, session },
    );
    if (!updated) continue;

    const movementKey = `bakery-sale:${createHash("sha256")
      .update(`${idempotencyKey}:${lineIndex}:${String(lot._id)}`)
      .digest("hex")}`;
    const [movement] = await FinishedStockLotMovement.create(
      [{
        lotId: lot._id,
        type: "Sales dispatch",
        direction: "out",
        quantity: allocated,
        date,
        reference,
        sourceType: "sale",
        sourceId: saleId,
        idempotencyKey: movementKey,
        reason,
        actor: actorId,
      }],
      { session },
    );
    dispatched.push({ lotId: lot._id, quantity: allocated, movementId: movement._id });
    remaining -= allocated;
  }

  if (remaining > 0) {
    throw conflict("There is not enough eligible, unreserved bakery stock to complete this sale.");
  }
  return dispatched;
}

module.exports = { dispatchBakerySaleLots };

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { argumentValue, mappingArgument, validateOpeningLots } = require("../scripts/migrateBakeryCatalog");

test("bakery migration requires explicit opening-lot locations and date snapshots", () => {
  const result = validateOpeningLots([{
    reference: "OPEN-BREAD-1",
    location: "Main Warehouse",
    productionDate: "2026-04-01",
    expiryDate: "2026-04-03",
    producedQuantity: 12,
    remainingQuantity: 8,
    reservedQuantity: 2,
  }], "legacy-product");
  assert.equal(result.error, undefined);
  assert.equal(result.remaining, 8);
  assert.equal(result.reserved, 2);
  assert.equal(validateOpeningLots([], "legacy-product").remaining, 0);
  assert.ok(validateOpeningLots([{
    reference: "OPEN-BREAD-1",
    productionDate: "2026-04-01",
    expiryDate: "2026-04-03",
    producedQuantity: 12,
    remainingQuantity: 8,
  }], "legacy-product").error);
  assert.ok(validateOpeningLots([{
    reference: "OPEN-BREAD-1",
    location: "Main Warehouse",
    productionDate: "2026-04-03",
    expiryDate: "2026-04-02",
    producedQuantity: 12,
    remainingQuantity: 8,
  }], "legacy-product").error);
});

test("bakery migration CLI requires a mapping path and reads explicit options", () => {
  assert.throws(() => mappingArgument([]), /--mapping/);
  assert.equal(mappingArgument(["--mapping", "reviewed-map.json"]), require("node:path").resolve("reviewed-map.json"));
  assert.equal(argumentValue(["--apply", "--actor-id", "507f1f77bcf86cd799439011"], "--actor-id"), "507f1f77bcf86cd799439011");
});

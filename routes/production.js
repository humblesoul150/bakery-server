const express = require("express");
const rawMaterialController = require("../controllers/rawMaterialController");
const { authenticate, requirePasswordChanged } = require("../middleware/authentication");
const audit = require("../lib/audit");
const { hasAnyDepartmentRole } = require("../lib/authorization");

const router = express.Router();
const bakeryController = require("../controllers/bakeryProductionController");
const readRoles = ["Admin", "General Manager", "Production Manager", "Inventory Manager"];
const productionWriteRoles = ["Production Manager", "Inventory Manager"];
const inventoryWriteRoles = ["Inventory Manager"];

function requireRoles(allowedRoles) {
  return async (request, response, next) => {
    if (hasAnyDepartmentRole(request.authUser, allowedRoles)) return next();
    await audit.recordAudit({
      request,
      eventType: "security.authorization_denied",
      outcome: "denied",
      reason: "production_role_required",
      actor: request.authUser,
      details: { resource: request.baseUrl },
    });
    return response.status(403).json({ error: "You do not have permission to access production and inventory records." });
  };
}

const authenticated = [authenticate, requirePasswordChanged];
const reader = [...authenticated, requireRoles(readRoles)];
const productionWriter = [...authenticated, requireRoles(productionWriteRoles)];
const inventoryWriter = [...authenticated, requireRoles(inventoryWriteRoles)];

for (const legacyPath of [
  "/products",
  "/products/:id",
  "/products/:id/recipe",
  "/stock/balances",
  "/stock/finished/movements",
  "/stock/finished/receipts",
  "/stock/finished/adjustments",
  "/runs",
  "/runs/daily-stock-summary",
]) {
  router.all(legacyPath, ...authenticated, (_request, response) =>
    response.status(410).json({ error: "Legacy beverage production and stock endpoints are no longer supported." }),
  );
}

router.get("/materials", reader, rawMaterialController.listMaterials);
router.get("/materials/lots", reader, rawMaterialController.listMaterialLots);
router.post("/materials/:materialId/receipts", inventoryWriter, rawMaterialController.receiveRawMaterial);
router.post("/materials/:materialId/adjustments", inventoryWriter, rawMaterialController.adjustRawMaterial);
router.get("/materials/movements", reader, rawMaterialController.listMovements);
router.all("/materials/production-usages", inventoryWriter, (_request, response) =>
  response.status(410).json({ error: "Legacy beverage material usage endpoints are no longer supported." }),
);
router.all("/materials/production-usages/:id", inventoryWriter, (_request, response) =>
  response.status(410).json({ error: "Legacy beverage material usage endpoints are no longer supported." }),
);


router.get("/bakery/families", reader, bakeryController.listFamilies);
router.post("/bakery/families", productionWriter, bakeryController.createFamily);
router.patch("/bakery/families/:id", productionWriter, bakeryController.updateFamily);
router.post("/bakery/families/:id/images/cleanup", productionWriter, bakeryController.retryFamilyImageCleanup);
router.delete("/bakery/families/:id/images/unattached", productionWriter, bakeryController.deleteUnattachedFamilyImage);
router.post("/bakery/families/:id/variants", productionWriter, bakeryController.addVariant);
router.patch("/bakery/variants/:id", productionWriter, bakeryController.updateVariant);
router.put("/bakery/families/:id/recipe", productionWriter, bakeryController.saveRecipe);
router.get("/bakery/batches", reader, bakeryController.listBatches);
router.post("/bakery/batches", productionWriter, bakeryController.createBatch);
router.post("/bakery/batches/:id/complete", productionWriter, bakeryController.completeBatch);
router.get("/bakery/lots", reader, bakeryController.listLots);
router.get("/bakery/lots/movements", reader, bakeryController.listLotMovements);
router.post("/bakery/lots/receipts", inventoryWriter, bakeryController.receiveLot);
router.post("/bakery/lots/:id/adjustments", inventoryWriter, bakeryController.adjustLot);
router.post("/bakery/lots/:id/write-off", productionWriter, bakeryController.writeOffLot);

router.requireProductionReader = requireRoles(readRoles);
router.requireProductionWriter = requireRoles(productionWriteRoles);
router.requireInventoryWriter = requireRoles(inventoryWriteRoles);
module.exports = router;

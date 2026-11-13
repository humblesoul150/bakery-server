const express = require("express");
const controller = require("../controllers/productionController");
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

router.get("/products", reader, controller.listProducts);
router.post("/products", productionWriter, controller.createProduct);
router.patch("/products/:id", productionWriter, controller.updateProduct);
router.put("/products/:id/recipe", productionWriter, controller.changeRecipe);

router.get("/materials", reader, controller.listMaterials);
router.get("/materials/lots", reader, controller.listMaterialLots);
router.post("/materials", inventoryWriter, controller.createMaterial);
router.patch("/materials/:materialId", inventoryWriter, controller.updateMaterial);
router.delete("/materials/:materialId", inventoryWriter, controller.deleteMaterial);
router.get("/materials/responsible-users", reader, controller.listInventoryResponsibleUsers);
router.get("/materials/low-stock", reader, controller.listLowStockAlerts);
router.get("/materials/receipts", reader, controller.listMaterialReceipts);
router.get("/materials/production-usages", reader, controller.listProductionMaterialUsages);
router.post("/materials/production-usages", inventoryWriter, controller.legacyProductionMaterialUsageRetired);
router.patch("/materials/production-usages/:id", inventoryWriter, controller.legacyProductionMaterialUsageRetired);
router.put("/materials/:materialId/locations/:location", inventoryWriter, controller.configureMaterialLocation);
router.post("/materials/:materialId/receipts", inventoryWriter, controller.receiveRawMaterial);
router.get("/materials/movements", reader, controller.listRawMovements);
router.post("/materials/transfers", inventoryWriter, controller.transferRawMaterial);
router.post("/materials/adjustments", inventoryWriter, controller.adjustRawMaterial);
router.get("/materials/counts", reader, controller.listRawMaterialCounts);
router.post("/materials/counts/preview", inventoryWriter, controller.previewRawMaterialCount);
router.post("/materials/counts/drafts", inventoryWriter, controller.saveRawMaterialCount);
router.post("/materials/counts/submit", inventoryWriter, controller.submitRawMaterialCount);

router.get("/stock/balances", reader, controller.listStockBalances);
router.get("/stock/finished/movements", reader, controller.listFinishedMovements);
router.post("/stock/finished/receipts", inventoryWriter, controller.receiveFinishedStock);
router.post("/stock/finished/adjustments", inventoryWriter, controller.adjustFinishedStock);

router.get("/runs", reader, controller.listProductionRuns);
router.get("/runs/daily-stock-summary", reader, controller.getDailyProductionStockSummary);
router.post("/runs", productionWriter, controller.createProductionRun);

router.get("/bakery/families", reader, bakeryController.listFamilies);
router.post("/bakery/families", productionWriter, bakeryController.createFamily);
router.patch("/bakery/families/:id", productionWriter, bakeryController.updateFamily);
router.post("/bakery/families/:id/images/cleanup", productionWriter, bakeryController.retryFamilyImageCleanup);
router.delete("/bakery/families/:id/images/unattached", productionWriter, bakeryController.deleteUnattachedFamilyImage);
router.post("/bakery/families/:id/variants", productionWriter, bakeryController.addVariant);
router.put("/bakery/families/:id/recipe", productionWriter, bakeryController.saveRecipe);
router.get("/bakery/batches", reader, bakeryController.listBatches);
router.post("/bakery/batches", productionWriter, bakeryController.createBatch);
router.post("/bakery/batches/:id/complete", productionWriter, bakeryController.completeBatch);
router.get("/bakery/lots", reader, bakeryController.listLots);
router.post("/bakery/lots/:id/write-off", productionWriter, bakeryController.writeOffLot);

router.requireProductionReader = requireRoles(readRoles);
router.requireProductionWriter = requireRoles(productionWriteRoles);
router.requireInventoryWriter = requireRoles(inventoryWriteRoles);
module.exports = router;

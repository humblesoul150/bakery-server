const express = require("express");
const controller = require("../controllers/storefrontController");
const { getPublicStorefrontSettings } = require("../controllers/profileSettingsController");

const router = express.Router();

router.get("/catalog", controller.listCatalog);
router.get("/settings", getPublicStorefrontSettings);

module.exports = router;

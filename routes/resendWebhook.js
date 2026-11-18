const express = require("express");
const controller = require("../controllers/websiteCommunicationsController");

const router = express.Router();

router.post("/", controller.resendWebhook);

module.exports = router;

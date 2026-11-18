const express = require("express");
const rateLimit = require("express-rate-limit");
const controller = require("../controllers/storefrontController");
const communicationsController = require("../controllers/websiteCommunicationsController");
const { getPublicStorefrontSettings } = require("../controllers/profileSettingsController");

const router = express.Router();
const messageRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages were submitted. Please try again later." },
});
const newsletterRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many subscription requests were made. Please try again later." },
});

router.get("/catalog", controller.listCatalog);
router.get("/settings", getPublicStorefrontSettings);
router.post("/messages/contact", messageRateLimit, communicationsController.submitContactMessage);
router.post("/messages/custom-orders", messageRateLimit, communicationsController.submitCustomOrderEnquiry);
router.post("/newsletter/subscribe", newsletterRateLimit, communicationsController.subscribeToNewsletter);
router.get("/newsletter/confirm", communicationsController.confirmNewsletterSubscription);
router.post("/newsletter/unsubscribe", newsletterRateLimit, communicationsController.unsubscribeFromNewsletter);

module.exports = router;

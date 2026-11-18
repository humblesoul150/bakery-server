const express = require("express");
const controller = require("../controllers/websiteCommunicationsController");
const { authenticate, requirePasswordChanged } = require("../middleware/authentication");
const { requireAnyRole } = require("../middleware/roleAccess");

const router = express.Router();
const authenticated = [authenticate, requirePasswordChanged];
const messageReader = requireAnyRole(
  ["Admin", "General Manager", "Sales Manager", "Marketing Manager"],
  "website_messages_read_role_required",
  "You do not have permission to view website messages.",
);
const messageWriter = requireAnyRole(
  ["Admin", "General Manager", "Sales Manager", "Marketing Manager"],
  "website_messages_manage_role_required",
  "You do not have permission to manage website messages.",
);
const newsletterReader = requireAnyRole(
  ["Admin", "General Manager", "Marketing Manager"],
  "newsletter_read_role_required",
  "You do not have permission to view newsletter subscribers.",
);
const newsletterWriter = requireAnyRole(
  ["Admin", "General Manager", "Marketing Manager"],
  "newsletter_manage_role_required",
  "You do not have permission to manage newsletter subscribers.",
);

router.use(...authenticated);
router.get("/summary", messageReader, controller.getCommunicationSummary);
router.get("/messages", messageReader, controller.listConversations);
router.get("/messages/assignees", messageReader, controller.listMessageAssignees);
router.get("/messages/:id", messageReader, controller.getConversation);
router.patch("/messages/:id", messageWriter, controller.updateConversation);
router.post("/messages/:id/notes", messageWriter, controller.addConversationNote);
router.post("/messages/:id/replies", messageWriter, controller.sendConversationReply);
router.post(
  "/messages/:id/replies/:messageId/retry",
  messageWriter,
  (request, response) => controller.sendConversationReply(request, response, request.params.messageId),
);

router.get("/newsletter/subscribers", newsletterReader, controller.listSubscribers);
router.patch("/newsletter/subscribers/:id", newsletterWriter, controller.updateSubscriberStatus);
router.delete("/newsletter/subscribers/:id", newsletterWriter, controller.deleteSubscriber);
router.get("/newsletter/campaigns", newsletterReader, controller.listCampaigns);
router.post("/newsletter/campaigns", newsletterWriter, controller.createCampaign);
router.put("/newsletter/campaigns/:id", newsletterWriter, controller.updateCampaign);
router.get("/newsletter/campaigns/:id/preview", newsletterReader, controller.getCampaignPreview);
router.post("/newsletter/campaigns/:id/test", newsletterWriter, controller.sendCampaignTest);
router.post("/newsletter/campaigns/:id/send", newsletterWriter, controller.sendCampaign);

module.exports = router;

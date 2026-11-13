const { randomUUID } = require("node:crypto");
const express = require("express");
const mongoose = require("mongoose");
const {
  authenticate,
  requirePasswordChanged,
} = require("../middleware/authentication");
const { signUploadParams } = require("../configs/cloudinary");
const BakeryProductFamily = require("../models/bakeryProductFamily");
const audit = require("../lib/audit");
const { hasAnyDepartmentRole } = require("../lib/authorization");

const router = express.Router();

router.post(
  "/signed",
  authenticate,
  requirePasswordChanged,
  (request, response) => {
    const {
      folder = "anli/uploads",
      publicId,
      resourceType = "image",
      type = "upload",
      maxBytes = 1024 * 1024,
      allowedFormats,
    } = request.body || {};

    if (typeof folder !== "string" || folder.trim().length === 0) {
      return response
        .status(400)
        .json({ error: "A Cloudinary folder is required." });
    }
    if (resourceType !== "image" && resourceType !== "raw") {
      return response
        .status(400)
        .json({ error: "resourceType must be image or raw." });
    }
    if (
      !Number.isFinite(Number(maxBytes)) ||
      Number(maxBytes) <= 0 ||
      Number(maxBytes) > 10 * 1024 * 1024
    ) {
      return response
        .status(400)
        .json({ error: "maxBytes must be between 1 and 10 MB." });
    }

    const params = signUploadParams({
      folder: folder.trim(),
      publicId:
        typeof publicId === "string" && publicId.trim()
          ? publicId.trim()
          : undefined,
      resourceType,
      type,
      maxBytes: Number(maxBytes),
      allowedFormats:
        Array.isArray(allowedFormats) && allowedFormats.length
          ? allowedFormats.map(String)
          : undefined,
    });

    return response.json({
      uploadUrl: params.uploadUrl,
      apiKey: params.apiKey,
      timestamp: params.timestamp,
      signature: params.signature,
      publicId: params.publicId,
      folder: params.folder,
      cloudName: params.cloudName,
      resourceType: params.resourceType,
      type: params.type,
      maxBytes: params.maxBytes,
      allowedFormats: params.allowedFormats,
    });
  },
);

router.post(
  "/bakery-product-image/signed",
  authenticate,
  requirePasswordChanged,
  async (request, response) => {
    const roles = ["Production Manager", "Inventory Manager"];
    if (!hasAnyDepartmentRole(request.authUser, roles)) {
      await audit.recordAudit({
        request,
        eventType: "security.authorization_denied",
        outcome: "denied",
        reason: "production_role_required",
        actor: request.authUser,
        details: { resource: "production.bakery.product_image_upload" },
      });
      return response.status(403).json({ error: "You do not have permission to upload bakery product images." });
    }

    const { familyId } = request.body || {};
    if (typeof familyId !== "string" || !mongoose.isValidObjectId(familyId)) {
      return response.status(400).json({ error: "A valid product family ID is required." });
    }
    const familyExists = await BakeryProductFamily.exists({ _id: familyId });
    if (!familyExists) return response.status(404).json({ error: "Product family not found." });

    const params = signUploadParams({
      folder: "anli/bakery/products",
      publicId: `family-${familyId}-${randomUUID()}`,
      resourceType: "image",
      type: "upload",
      maxBytes: 5 * 1024 * 1024,
      allowedFormats: ["jpg", "jpeg", "png", "webp"],
    });
    return response.json({
      uploadUrl: params.uploadUrl,
      apiKey: params.apiKey,
      timestamp: params.timestamp,
      signature: params.signature,
      publicId: params.publicId,
      folder: params.folder,
      cloudName: params.cloudName,
      resourceType: params.resourceType,
      type: params.type,
      maxBytes: params.maxBytes,
      allowedFormats: params.allowedFormats,
    });
  },
);

module.exports = router;

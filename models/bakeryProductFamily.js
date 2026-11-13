const mongoose = require("mongoose");

const publicImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 1000 },
    publicId: { type: String, trim: true, maxlength: 255 },
    altText: { type: String, trim: true, maxlength: 240, default: "" },
    sortOrder: { type: Number, min: 0, validate: Number.isInteger, default: 0 },
  },
  { _id: false },
);

const storefrontSchema = new mongoose.Schema(
  {
    published: { type: Boolean, default: false },
    slug: { type: String, trim: true, lowercase: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 2000, default: "" },
    images: { type: [publicImageSchema], default: [] },
    ingredientsStatement: { type: String, trim: true, maxlength: 2000, default: "" },
    allergens: [{ type: String, trim: true, maxlength: 80 }],
  },
  { _id: false },
);

const bakeryProductFamilySchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    flavour: { type: String, trim: true, maxlength: 80, default: "" },
    baseUnit: { type: String, required: true, trim: true, maxlength: 24 },
    activeRecipeId: { type: mongoose.Schema.Types.ObjectId, ref: "BakeryRecipe", default: null },
    shelfLifeDays: { type: Number, required: true, min: 0.25, max: 365, default: 2 },
    dateLabelType: { type: String, enum: ["best_before", "use_by"], default: "best_before", required: true },
    storageInstructions: { type: String, trim: true, maxlength: 500, default: "" },
    storefront: { type: storefrontSchema, default: () => ({}) },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, value) {
        value.id = String(value._id);
        delete value._id;
        delete value.__v;
        return value;
      },
    },
  },
);

bakeryProductFamilySchema.index({ code: 1 }, { unique: true });
bakeryProductFamilySchema.index({ "storefront.slug": 1 }, { unique: true, sparse: true });
bakeryProductFamilySchema.index({ category: 1, active: 1, name: 1 });

module.exports = mongoose.models.BakeryProductFamily ||
  mongoose.model("BakeryProductFamily", bakeryProductFamilySchema);

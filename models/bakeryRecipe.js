const mongoose = require("mongoose");

const ingredientSchema = new mongoose.Schema(
  {
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: "RawMaterial", required: true },
    materialName: { type: String, required: true, trim: true, maxlength: 160 },
    unit: { type: String, required: true, trim: true, maxlength: 24 },
    quantityPerBatch: { type: Number, required: true, min: 0.000001 },
  },
  { _id: false },
);

const bakeryRecipeSchema = new mongoose.Schema(
  {
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: "BakeryProductFamily", required: true, index: true },
    version: { type: Number, required: true, min: 1, validate: Number.isInteger },
    batchYield: { type: Number, required: true, min: 0.000001 },
    yieldUnit: { type: String, required: true, trim: true, maxlength: 40 },
    ingredients: {
      type: [ingredientSchema],
      required: true,
      validate: [(items) => items.length > 0, "A bakery recipe must contain at least one ingredient."],
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
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

bakeryRecipeSchema.index({ familyId: 1, version: 1 }, { unique: true });

module.exports = mongoose.models.BakeryRecipe ||
  mongoose.model("BakeryRecipe", bakeryRecipeSchema);

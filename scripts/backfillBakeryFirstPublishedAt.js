require("dotenv").config();
const mongoose = require("mongoose");
const BakeryProductFamily = require("../models/bakeryProductFamily");

async function backfillFirstPublishedAt({
  Family = BakeryProductFamily,
  apply = false,
  batchSize = 500,
} = {}) {
  const cursor = Family.find({
    "storefront.published": true,
    "storefront.firstPublishedAt": null,
  })
    .select("_id createdAt")
    .lean()
    .cursor();
  let candidates = 0;
  let updated = 0;
  let operations = [];

  const flush = async () => {
    if (!operations.length) return;
    const result = await Family.bulkWrite(operations, { ordered: false });
    updated += result.modifiedCount;
    operations = [];
  };

  for await (const family of cursor) {
    if (!family.createdAt) {
      throw new Error(
        `Published bakery family ${String(family._id)} has no createdAt value to backfill.`,
      );
    }
    candidates += 1;
    if (!apply) continue;
    operations.push({
      updateOne: {
        filter: {
          _id: family._id,
          "storefront.published": true,
          "storefront.firstPublishedAt": null,
        },
        update: {
          $set: { "storefront.firstPublishedAt": family.createdAt },
        },
      },
    });
    if (operations.length >= batchSize) await flush();
  }
  if (apply) await flush();
  return { candidates, updated };
}

async function main() {
  const dbUrl = process.env.DB_URL;
  if (!dbUrl) throw new Error("DB_URL is required to run this backfill.");
  await mongoose.connect(dbUrl);
  try {
    const apply = process.argv.includes("--apply");
    const result = await backfillFirstPublishedAt({ apply });
    console.log(
      apply
        ? `Backfilled ${result.updated} of ${result.candidates} published bakery families.`
        : `${result.candidates} published bakery families need a first-publish date. Re-run with --apply to backfill from createdAt.`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Bakery first-published-at backfill failed:", error);
    process.exitCode = 1;
  });
}

module.exports = { backfillFirstPublishedAt };

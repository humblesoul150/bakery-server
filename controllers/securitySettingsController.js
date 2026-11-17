const mongoose = require("mongoose");
const SecuritySettings = require("../models/securitySettings");
const audit = require("../lib/audit");
const {
  SETTINGS_ID,
  cacheSecuritySettings,
} = require("../lib/securitySettings");

const SESSION_SETTINGS = ["privilegedIdle", "generalIdle", "warningPeriod"];
const LOGIN_SETTINGS = [
  "lockoutEnabled",
  "maxAttempts",
  "attemptWindow",
  "lockDuration",
  "maxLockoutsBeforeManual",
  "escalationWindowHours",
  "notifyLockouts",
];
const ranges = {
  privilegedIdle: [5, 240],
  generalIdle: [5, 480],
  warningPeriod: [1, 10],
  maxAttempts: [3, 20],
  attemptWindow: [1, 120],
  lockDuration: [1, 1440],
  maxLockoutsBeforeManual: [2, 10],
  escalationWindowHours: [1, 168],
};

function sessionProtection(settings) {
  return {
    privilegedIdle: settings.privilegedIdle,
    generalIdle: settings.generalIdle,
    warningPeriod: settings.warningPeriod,
  };
}

function loginProtection(settings) {
  return Object.fromEntries(LOGIN_SETTINGS.map((key) => [key, settings[key]]));
}

async function getSettings(_request, response) {
  const settings = await SecuritySettings.findById(SETTINGS_ID);
  const document = settings || new SecuritySettings({ _id: SETTINGS_ID });
  if (!settings) await document.save();
  return response.json({
    sessionProtection: sessionProtection(document),
    loginProtection: loginProtection(document),
  });
}

async function updateSettings(request, response) {
  const body = request.body || {};
  const keys = Object.keys(body);
  if (
    keys.length !== SESSION_SETTINGS.length ||
    SESSION_SETTINGS.some((key) => !Object.prototype.hasOwnProperty.call(body, key))
  ) {
    return response.status(400).json({
      error: "Provide privilegedIdle, generalIdle, and warningPeriod.",
    });
  }

  for (const key of SESSION_SETTINGS) {
    const value = body[key];
    const [minimum, maximum] = ranges[key];
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      return response.status(400).json({
        error: `${key} must be an integer between ${minimum} and ${maximum}.`,
      });
    }
  }

  const transaction = await mongoose.startSession();
  let settings;
  try {
    await transaction.withTransaction(async () => {
      settings = await SecuritySettings.findByIdAndUpdate(
        SETTINGS_ID,
        { $set: body },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
          session: transaction,
        },
      );
      await audit.recordAudit({
        request,
        eventType: "security.session_policy_updated",
        outcome: "success",
        details: {
          privilegedIdle: settings.privilegedIdle,
          generalIdle: settings.generalIdle,
          warningPeriod: settings.warningPeriod,
        },
        transaction,
      });
    });
  } finally {
    await transaction.endSession();
  }
  cacheSecuritySettings(settings.toObject());
  return response.json({
    sessionProtection: sessionProtection(settings),
  });
}

async function updateLoginProtection(request, response) {
  const body = request.body || {};
  const keys = Object.keys(body);
  if (
    keys.length !== LOGIN_SETTINGS.length
    || LOGIN_SETTINGS.some((key) => !Object.prototype.hasOwnProperty.call(body, key))
  ) {
    return response.status(400).json({
      error: `Provide ${LOGIN_SETTINGS.join(", ")}.`,
    });
  }

  for (const key of ["lockoutEnabled", "notifyLockouts"]) {
    if (typeof body[key] !== "boolean") {
      return response.status(400).json({ error: `${key} must be true or false.` });
    }
  }
  for (const key of LOGIN_SETTINGS.filter((item) => item !== "lockoutEnabled" && item !== "notifyLockouts")) {
    const [minimum, maximum] = ranges[key];
    if (!Number.isInteger(body[key]) || body[key] < minimum || body[key] > maximum) {
      return response.status(400).json({
        error: `${key} must be an integer between ${minimum} and ${maximum}.`,
      });
    }
  }

  const transaction = await mongoose.startSession();
  let settings;
  try {
    await transaction.withTransaction(async () => {
      settings = await SecuritySettings.findByIdAndUpdate(
        SETTINGS_ID,
        { $set: body },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true,
          session: transaction,
        },
      );
      await audit.recordAudit({
        request,
        eventType: "security.login_policy_updated",
        outcome: "success",
        details: loginProtection(settings),
        transaction,
      });
    });
  } finally {
    await transaction.endSession();
  }

  cacheSecuritySettings(settings.toObject());
  return response.json({ loginProtection: loginProtection(settings) });
}

module.exports = { getSettings, updateLoginProtection, updateSettings };

"use strict";

const crypto = require("crypto");

function normalizeAddress(value) {
  return String(value || "").trim().toLowerCase();
}

function isLoopbackAddress(value) {
  const ip = normalizeAddress(value);
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function tokenMatches(expected, presented) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(presented || ""));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function webhookAllowed({ remoteAddress, configuredToken, presentedToken }) {
  if (isLoopbackAddress(remoteAddress)) return true;
  return tokenMatches(configuredToken, presentedToken);
}

function isCrossSiteBrowserRequest(secFetchSite) {
  return normalizeAddress(secFetchSite) === "cross-site";
}

function browserMutationAllowed({ secFetchSite, origin, host }) {
  if (isCrossSiteBrowserRequest(secFetchSite)) return false;
  // Non-browser clients such as curl, Plex, and the local analyzer usually do
  // not send Origin. Keep those workflows valid. When a browser does identify
  // an origin, require it to be the RSVP host serving the control page.
  if (!origin) return true;
  try {
    return normalizeAddress(new URL(String(origin)).host) === normalizeAddress(host);
  } catch (_) {
    return false;
  }
}

module.exports = {
  isLoopbackAddress,
  tokenMatches,
  webhookAllowed,
  isCrossSiteBrowserRequest,
  browserMutationAllowed,
};

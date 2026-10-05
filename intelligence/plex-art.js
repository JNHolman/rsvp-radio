"use strict";

function browserSafeSourceUrl(thumb, plexBase) {
  if (!thumb) return "";
  let base;
  let url;
  try {
    base = new URL(plexBase);
    url = new URL(String(thumb), base);
  } catch (_) {
    return "";
  }
  if (url.host !== base.host) return "";
  url.searchParams.delete("X-Plex-Token");
  return url.toString();
}

function authenticatedSourceUrl(rawUrl, plexBase, plexToken) {
  let base;
  let url;
  try {
    base = new URL(plexBase);
    url = new URL(String(rawUrl));
  } catch (_) {
    return { ok: false, reason: "invalid_url", url: "" };
  }
  if (url.host !== base.host) return { ok: false, reason: "forbidden", url: "" };
  url.searchParams.delete("X-Plex-Token");
  if (plexToken) url.searchParams.set("X-Plex-Token", plexToken);
  return { ok: true, reason: "", url: url.toString() };
}

module.exports = { browserSafeSourceUrl, authenticatedSourceUrl };

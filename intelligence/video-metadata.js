"use strict";

const plexParser = require("./plex-parser");

function attribute(tag, name) {
  const match = String(tag || "").match(new RegExp("\\b" + name + '="([^"]*)"', "i"));
  return match ? plexParser.decodeXmlEntities(match[1]) : "";
}

function parseVideoMetadata(xml, ratingKey) {
  const source = String(xml || "");
  const item = (source.match(/<(?:Video|Track)\b[^>]*>/i) || [""])[0];
  const part = (source.match(/<Part\b[^>]*>/i) || [""])[0];
  const filePath = attribute(part, "file");

  let artist = "";
  let title = "";
  if (filePath) {
    const basename = filePath.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
    const split = basename.indexOf(" - ");
    if (split >= 0) {
      artist = basename.slice(0, split).trim();
      title = basename.slice(split + 3).trim()
        .replace(/(\s*\([^)]*\))+\s*$/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    } else {
      title = basename;
    }
  }

  if (!artist) artist = attribute(item, "grandparentTitle") || attribute(item, "originalTitle");
  if (!title) title = attribute(item, "title");

  const thumb = attribute(item, "thumb") ||
    attribute(item, "parentThumb") ||
    attribute(item, "grandparentThumb") ||
    attribute(item, "art");

  const duration = Number.parseInt(attribute(part, "duration") || attribute(item, "duration") || "0", 10) || 0;

  return {
    ratingKey: String(ratingKey || attribute(item, "ratingKey") || ""),
    title: title || "Video",
    artist,
    album: attribute(item, "parentTitle"),
    thumb,
    duration,
  };
}

module.exports = { parseVideoMetadata };

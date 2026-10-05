"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Persist JSON without ever exposing a partially-written destination file.
 * This matters on the Pi where a sudden reboot/power loss must not destroy
 * accumulated RSVP session/reputation state.
 */
function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmp = `${filePath}.tmp-${process.pid}`;
  let fd;
  try {
    fd = fs.openSync(tmp, "w", 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, filePath);

    // Best effort directory sync so the rename itself survives sudden power loss.
    try {
      const dirFd = fs.openSync(dir, "r");
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch (_) {}
    return true;
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
    }
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

module.exports = { writeJsonAtomic };
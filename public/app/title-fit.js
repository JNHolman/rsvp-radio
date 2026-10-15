/* RSVP TV — measured title fitting, not character-count guessing.
   Keeps short/medium names on one line when couch-readable; otherwise chooses
   balanced lines without leaving a final word or numeral stranded. Display
   only. It never controls Plexamp, queues, schedules, or lighting. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RsvpTitleFit = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const END_WORDS = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with", "&"]);

  function bestTitleLayout(text, availableWidth, baseSize, measure) {
    const title = String(text || "").trim().replace(/\s+/g, " ");
    const width = Number(availableWidth);
    const base = Number(baseSize);
    if (!title || !Number.isFinite(width) || width <= 0 || !Number.isFinite(base) || base <= 0) {
      return { lines: [title], fontSize: Math.max(1, base || 1) };
    }
    // Preserve one-line titles down to ~82% before considering a wrap.
    // This keeps names such as "Dangerously in Love 2" from isolating "2".
    const singleFloor = Math.max(24, base * .82);
    if (measure(title, base) <= width) return { lines: [title], fontSize: base };
    if (measure(title, singleFloor) <= width) {
      let lo = singleFloor, hi = base;
      for (let n = 0; n < 12; n += 1) {
        const mid = (lo + hi) / 2;
        if (measure(title, mid) <= width) lo = mid;
        else hi = mid;
      }
      return { lines: [title], fontSize: Math.floor(lo * 10) / 10 };
    }

    const words = title.split(" ");
    const minTwo = Math.max(24, base * .66);
    let candidate = null;
    // Prefer TWO natural lines, with at least two words per line.
    // Penalize a dangling article/preposition at the end of the first line.
    if (words.length >= 4) {
      for (let i = 2; i <= words.length - 2; i += 1) {
        const first = words.slice(0, i).join(" ");
        const second = words.slice(i).join(" ");
        for (let size = base; size >= minTwo; size -= .5) {
          const a = measure(first, size);
          const b = measure(second, size);
          if (Math.max(a, b) <= width) {
            const lastToken = words[i - 1].toLowerCase().replace(/[^a-z&]/g, "");
            const penalty = END_WORDS.has(lastToken) ? 30 : 0;
            const score = size * 100 - Math.abs(a - b) * .08 - penalty;
            if (!candidate || score > candidate.score) candidate = { lines: [first, second], fontSize: size, score };
            break;
          }
        }
      }
    }
    if (candidate) return { lines: candidate.lines, fontSize: candidate.fontSize };

    // Very long titles can use three balanced lines, without an orphan line.
    if (words.length >= 6) {
      for (let i = 2; i <= words.length - 4; i += 1) {
        for (let j = i + 2; j <= words.length - 2; j += 1) {
          const lines = [words.slice(0, i).join(" "), words.slice(i, j).join(" "), words.slice(j).join(" ")];
          for (let size = base; size >= minTwo; size -= .5) {
            const lengths = lines.map(line => measure(line, size));
            if (Math.max(...lengths) <= width) {
              const penalty = Math.max(...lengths) - Math.min(...lengths);
              const score = size * 100 - penalty * .08;
              if (!candidate || score > candidate.score) candidate = { lines, fontSize: size, score };
              break;
            }
          }
        }
      }
      if (candidate) return { lines: candidate.lines, fontSize: candidate.fontSize };
    }

    // Unusually long unbroken words: allow ordinary CSS breaking within the
    // existing bounded column rather than spilling over the record or cropping.
    return { lines: [title], fontSize: minTwo };
  }

  function fitElement(element, title) {
    if (!element || !element.parentElement || typeof document === "undefined") return null;
    const raw = String(title || element.textContent || "").trim();
    element.style.fontSize = "";
    element.textContent = raw;
    const width = Math.max(0, element.parentElement.getBoundingClientRect().width - 2);
    if (width < 1) return null;
    const style = window.getComputedStyle(element);
    const base = parseFloat(style.fontSize);
    const weight = style.fontWeight || "800";
    const family = style.fontFamily || "system-ui";
    const spacing = parseFloat(style.letterSpacing) || 0;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx || !Number.isFinite(base)) return null;
    const measure = (value, size) => {
      ctx.font = weight + " " + size + "px " + family;
      return ctx.measureText(value).width + Math.max(0, value.length - 1) * spacing;
    };
    const result = bestTitleLayout(raw, width, base, measure);
    element.style.fontSize = result.fontSize.toFixed(1) + "px";
    element.textContent = result.lines.join("\n");
    element.title = raw;
    return result;
  }
  return { bestTitleLayout, fitElement };
});

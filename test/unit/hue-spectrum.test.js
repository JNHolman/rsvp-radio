"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AUTO_FAMILIES, autoSpectrumColor, angleDistance, hsvToHex } = require("../../intelligence/hue-spectrum");
const { PALETTES } = require("../../intelligence/ambient-light");

test("AUTO includes meaningful warm and cool artwork-complementary color families", () => {
  assert.ok(AUTO_FAMILIES.day.length >= 10);
  assert.ok(AUTO_FAMILIES.night.length >= 10);
  const families = {
    day: AUTO_FAMILIES.day.map(f => f.id),
    night: AUTO_FAMILIES.night.map(f => f.id),
  };
  for (const phase of ["day", "night"]) {
    assert.equal(new Set(families[phase]).size, families[phase].length);
    assert.ok(AUTO_FAMILIES[phase].some(f => f.from >= 120 && f.to <= 160), phase + " needs jade/green");
    assert.ok(AUTO_FAMILIES[phase].some(f => f.from >= 160 && f.to <= 200), phase + " needs teal");
    assert.ok(AUTO_FAMILIES[phase].some(f => f.from >= 20 && f.to <= 55), phase + " needs warm gold/amber");
    assert.ok(AUTO_FAMILIES[phase].some(f => f.from >= 200 && f.to <= 240), phase + " needs blue");
    assert.ok(AUTO_FAMILIES[phase].some(f => f.from >= 260 && f.to <= 340), phase + " needs purple/magenta");
    assert.ok(AUTO_FAMILIES[phase].every(f => f.from >= 0 && f.to < 360 && f.to >= f.from));
  }
  // Approved palette anchors and artwork preview remain untouched.
  assert.deepEqual(PALETTES.day.accents, ["#287EC2", "#D69A37", "#B96A38", "#D47B65", "#B96C91"]);
  assert.deepEqual(PALETTES.night.accents, ["#264CC0", "#352B91", "#6625A9", "#B52D8B", "#D36A61", "#3576C8"]);
});

test("dynamic spectrum produces hundreds of saturated variants, not fixed swatches", () => {
  for (const phase of ["day", "night"]) {
    const colors = new Set(), families = new Set(), hueOffsets = new Set();
    const history = [];
    for (let i = 0; i < 240; i++) {
      const chosen = autoSpectrumColor(phase, Math.imul(i + 11, 2654435761) >>> 0, history);
      const family = AUTO_FAMILIES[phase].find(f => f.id === chosen.family);
      assert.ok(family);
      assert.ok(chosen.hueDegrees >= family.from && chosen.hueDegrees <= family.to);
      assert.match(chosen.color, /^#[0-9A-F]{6}$/);
      const channel = [1,3,5].map(index => parseInt(chosen.color.slice(index,index+2),16));
      assert.ok(Math.max(...channel) - Math.min(...channel) >= 100,
        "color too muted: " + chosen.color);
      assert.ok(chosen.saturation >= 0.79, "do not create pale/washed-out shades");
      if (history.length) {
        assert.notEqual(chosen.family, history[history.length - 1].family);
        if (history.length > 1) assert.notEqual(chosen.family, history[history.length - 2].family);
      }
      colors.add(chosen.color);
      families.add(chosen.family);
      hueOffsets.add(chosen.hueDegrees);
      history.push(chosen);
    }
    assert.ok(colors.size >= 175, phase + " should use hundreds of shades");
    assert.ok(hueOffsets.size >= 95, phase + " should vary hues within families");
    assert.ok(families.size >= 9, phase + " must explore many color families");
  }
});

test("the same event seed reproduces precisely the same Hue destination", () => {
  for (const phase of ["day", "night"]) {
    const history = [autoSpectrumColor(phase, 42), autoSpectrumColor(phase, 43)];
    assert.deepEqual(autoSpectrumColor(phase, 987654321, history),
      autoSpectrumColor(phase, 987654321, history));
  }
});

test("color conversion and angle wrapping are valid throughout the hue wheel", () => {
  assert.equal(hsvToHex(0, 1, 1), "#FF0000");
  assert.equal(hsvToHex(120, 1, 1), "#00FF00");
  assert.equal(hsvToHex(240, 1, 1), "#0000FF");
  assert.equal(angleDistance(355, 5), 10);
  assert.equal(angleDistance(180, 0), 180);
  assert.throws(() => autoSpectrumColor("dusk", 42), /invalid_solar_phase/);
  assert.throws(() => autoSpectrumColor("day", -1), /invalid_color_seed/);
});

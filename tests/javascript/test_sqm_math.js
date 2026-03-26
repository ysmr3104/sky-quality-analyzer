// test_sqm_math.js - Unit tests for sqm_math.js
// Run: node tests/javascript/test_sqm_math.js

var math = require("../../javascript/sqm_math.js");

var passed = 0;
var failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log("  PASS: " + message);
        passed++;
    } else {
        console.log("  FAIL: " + message);
        failed++;
    }
}

function assertClose(actual, expected, tolerance, message) {
    var diff = Math.abs(actual - expected);
    if (diff <= tolerance) {
        console.log("  PASS: " + message + " (got " + actual.toFixed(4) + ")");
        passed++;
    } else {
        console.log("  FAIL: " + message + " (expected " + expected + " ±" + tolerance + ", got " + actual.toFixed(4) + ")");
        failed++;
    }
}

// ============================================================
// median
// ============================================================
console.log("\n--- median ---");

assertClose(math.median([1, 2, 3, 4, 5]), 3, 0.001, "odd-length array");
assertClose(math.median([1, 2, 3, 4]),    2.5, 0.001, "even-length array");
assertClose(math.median([42]),            42, 0.001, "single element");
assertClose(math.median([5, 1, 3, 2, 4]),3, 0.001, "unsorted array");

// ============================================================
// sigmaClippingStats
// ============================================================
console.log("\n--- sigmaClippingStats ---");

var normal = [100, 101, 102, 98, 99, 103, 97, 100, 101, 102];
var withOutlier = normal.concat([500, 1000]); // outliers

var r1 = math.sigmaClippingStats(normal, 3, 5);
assertClose(r1.median, 100.5, 1.0, "clean data: median near 100.5");
assert(r1.count === 10, "clean data: no clipping");

var r2 = math.sigmaClippingStats(withOutlier, 3, 5);
assertClose(r2.median, 100.5, 1.0, "with outliers: median near 100.5");
assert(r2.count < withOutlier.length, "with outliers: outliers were clipped");

// ============================================================
// linearFit
// ============================================================
console.log("\n--- linearFit ---");

// Perfect line: y = 51.6 * x
var tExp  = [1, 2, 4, 6, 8, 10];
var adSky = [51.6, 103.2, 206.4, 309.6, 412.8, 516.0];
var fit1 = math.linearFit(tExp, adSky);
assertClose(fit1.slope,     51.6, 0.01, "perfect line: slope = 51.6");
assertClose(fit1.intercept, 0.0,  0.1,  "perfect line: intercept ≈ 0");
assertClose(fit1.r2,        1.0,  0.001,"perfect line: R² = 1.0");

// Line with small noise
var adSkyNoisy = [52, 104, 205, 311, 414, 515];
var fit2 = math.linearFit(tExp, adSkyNoisy);
assertClose(fit2.slope, 51.6, 1.0,  "noisy data: slope ≈ 51.6");
assert(fit2.r2 > 0.999,              "noisy data: R² > 0.999");

// ============================================================
// computeLSky / computeLStar
// ============================================================
console.log("\n--- computeLSky / computeLStar ---");

var skyFrames = [
    { exptime: 1,  adu_sky: 51.64 },
    { exptime: 2,  adu_sky: 103.28 },
    { exptime: 4,  adu_sky: 206.56 },
    { exptime: 6,  adu_sky: 309.84 },
    { exptime: 8,  adu_sky: 413.12 },
    { exptime: 10, adu_sky: 516.40 }
];
var sky = math.computeLSky(skyFrames);
assertClose(sky.L_sky, 51.64, 0.1, "L_sky = 51.64 counts/s/px");
assertClose(sky.r2,    1.0,   0.001,"L_sky R² = 1.0");

var starFrames = [
    { exptime: 1,  adu_star: 200000 },
    { exptime: 2,  adu_star: 400000 },
    { exptime: 4,  adu_star: 800000 },
    { exptime: 6,  adu_star: 1200000 },
    { exptime: 8,  adu_star: 1600000 },
    { exptime: 10, adu_star: 2000000 }
];
var star = math.computeLStar(starFrames);
assertClose(star.L_star, 200000, 1, "L_star = 200000 counts/s");
assertClose(star.r2,     1.0, 0.001,"L_star R² = 1.0");

// ============================================================
// computePixelScale
// ============================================================
console.log("\n--- computePixelScale ---");

// ASI294MC Pro + RedCat 51: 4.63μm / 250mm × 206.265 = 3.82 arcsec/px
assertClose(math.computePixelScale(4.63, 250, 1), 3.82, 0.01, "ASI294MC Pro + RedCat 51");
// DWARF 3: 2.00μm / 100mm × 206.265 = 4.125 arcsec/px
assertClose(math.computePixelScale(2.00, 100, 1), 4.125, 0.01, "DWARF 3");
// binning 2x
assertClose(math.computePixelScale(4.63, 250, 2), 7.64, 0.01, "ASI294MC Pro + RedCat 51 + 2x binning");

// ============================================================
// computeLPrimeSky
// ============================================================
console.log("\n--- computeLPrimeSky ---");

// Reference article: L_sky=51.64, pixel_scale=7.1 → L'_sky = 51.64 / 7.1² = 1.024
var lPrime = math.computeLPrimeSky(51.64, 7.1);
assertClose(lPrime, 1.024, 0.01, "L'_sky with pixel_scale=7.1 arcsec/px");

// ============================================================
// computeSQM
// ============================================================
console.log("\n--- computeSQM ---");

// Reference article example:
// L_sky=51.64, pixel_scale=7.1, L_star=2.0e6, m0=4.7 → SQM ≈ 18.4
// Reference article: ASI294MC Pro + 135mm lens, Tarazed (gamma Aql, V=2.72 mag)
// L_sky=51.64 counts/s/px, pixel_scale=7.1 arcsec/px, L_star=2.0e6 counts/s
// SQM = 2.5*log10(2e6 / (51.64/7.1²)) + 2.72 ≈ 18.4
// Note: m0=2.72 is Tarazed's actual V magnitude (not 4.7)
var lSky2   = 51.64;
var ps      = 7.1;
var lStar2  = 2.0e6;
var m0      = 2.72;
var lPrime2 = math.computeLPrimeSky(lSky2, ps);
var sqm = math.computeSQM(lStar2, lPrime2, m0);
assertClose(sqm, 18.4, 0.1, "reference article example: SQM ≈ 18.4 (Tarazed V=2.72)");

// Edge cases
assert(isNaN(math.computeSQM(0, 1.0, 4.7)),  "L_star=0 returns NaN");
assert(isNaN(math.computeSQM(1.0, 0, 4.7)),  "L'_sky=0 returns NaN");
assert(isNaN(math.computeSQM(-1, 1.0, 4.7)), "negative L_star returns NaN");

// ============================================================
// skyConditionLabel
// ============================================================
console.log("\n--- skyConditionLabel ---");

assert(math.skyConditionLabel(22.5) === "Pristine Dark Sky",          "22.5 → Pristine Dark Sky");
assert(math.skyConditionLabel(21.7) === "Truly Dark Sky",             "21.7 → Truly Dark Sky");
assert(math.skyConditionLabel(21.2) === "Rural Sky",                  "21.2 → Rural Sky");
assert(math.skyConditionLabel(20.5) === "Rural/Suburban Transition",  "20.5 → Rural/Suburban Transition");
assert(math.skyConditionLabel(19.5) === "Suburban Sky",               "19.5 → Suburban Sky");
assert(math.skyConditionLabel(18.4) === "Bright Suburban Sky",        "18.4 → Bright Suburban Sky");
assert(math.skyConditionLabel(17.0) === "Urban Sky",                  "17.0 → Urban Sky");

// ============================================================
// normalizedToADU
// ============================================================
console.log("\n--- normalizedToADU ---");

assertClose(math.normalizedToADU(1.0, 16),   65535,      1,  "16bit: max = 65535");
assertClose(math.normalizedToADU(0.5, 16),   32767.5,    1,  "16bit: half = 32767.5");
assertClose(math.normalizedToADU(0.008, 16), 524.28,     1,  "16bit: 0.008 ≈ 524 ADU");
assertClose(math.normalizedToADU(1.0, 32),   4294967295, 1,  "32bit: max");

// ============================================================
// Summary
// ============================================================
console.log("\n============================");
console.log("Results: " + passed + " passed, " + failed + " failed");
if (failed === 0) {
    console.log("All tests passed.");
} else {
    console.log("Some tests FAILED.");
    process.exit(1);
}

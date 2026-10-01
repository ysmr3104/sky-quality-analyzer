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

// Representative values
assert(math.skyConditionLabel(22.5) === "Pristine Dark Sky",          "22.5 → Pristine Dark Sky");
assert(math.skyConditionLabel(21.7) === "Truly Dark Sky",             "21.7 → Truly Dark Sky");
assert(math.skyConditionLabel(21.2) === "Rural Sky",                  "21.2 → Rural Sky");
assert(math.skyConditionLabel(20.5) === "Rural/Suburban Transition",  "20.5 → Rural/Suburban Transition");
assert(math.skyConditionLabel(19.5) === "Suburban Sky",               "19.5 → Suburban Sky");
assert(math.skyConditionLabel(18.4) === "Bright Suburban Sky",        "18.4 → Bright Suburban Sky");
assert(math.skyConditionLabel(17.0) === "Urban Sky",                  "17.0 → Urban Sky");

// Boundary values (exact thresholds)
assert(math.skyConditionLabel(22.0) === "Pristine Dark Sky",         "22.0 → Pristine Dark Sky (boundary)");
assert(math.skyConditionLabel(21.5) === "Truly Dark Sky",            "21.5 → Truly Dark Sky (boundary)");
assert(math.skyConditionLabel(21.0) === "Rural Sky",                 "21.0 → Rural Sky (boundary)");
assert(math.skyConditionLabel(20.0) === "Rural/Suburban Transition", "20.0 → Rural/Suburban Transition (boundary)");
assert(math.skyConditionLabel(19.0) === "Suburban Sky",              "19.0 → Suburban Sky (boundary)");
assert(math.skyConditionLabel(18.0) === "Bright Suburban Sky",       "18.0 → Bright Suburban Sky (boundary)");
assert(math.skyConditionLabel(17.999) === "Urban Sky",               "17.999 → Urban Sky (just below 18.0)");

// ============================================================
// normalizedToADU
// ============================================================
console.log("\n--- normalizedToADU ---");

assertClose(math.normalizedToADU(1.0, false, 16),   65535,      1,  "16bit int: max = 65535");
assertClose(math.normalizedToADU(0.5, false, 16),   32767.5,    1,  "16bit int: half = 32767.5");
assertClose(math.normalizedToADU(0.008, false, 16), 524.28,     1,  "16bit int: 0.008 ≈ 524 ADU");
assertClose(math.normalizedToADU(1.0, false, 32),   4294967295, 1,  "32bit int: max");
assertClose(math.normalizedToADU(1.0, true, 32),    65535,      1,  "32bit float: max = 65535 (16bit equivalent)");
assertClose(math.normalizedToADU(0.008, true, 32),  524.28,     1,  "32bit float: 0.008 ≈ 524 ADU");

// normalizedToADU() scales linearly by maxADUFor(), so a 0.97-of-maxADU limit is a 0.97 normalized limit for every format
// (aperturePhotometry compares sample*maxADU with SAT_THRESHOLD*maxADU; this only checks the linearity)
var satOk = true;
var fmts = [[true, 32], [false, 32], [false, 16], [true, 16]];
for (var fi = 0; fi < fmts.length; fi++) {
    var mx = math.maxADUFor(fmts[fi][0], fmts[fi][1]);
    var lim = 0.97 * mx;
    if (!(math.normalizedToADU(0.97, fmts[fi][0], fmts[fi][1]) >= lim)) satOk = false;
    if (math.normalizedToADU(0.969, fmts[fi][0], fmts[fi][1]) >= lim) satOk = false;
}
assert(satOk, "normalizedToADU is linear in maxADUFor for all formats");

// ============================================================
// maxADUFor
// ============================================================
console.log("\n--- maxADUFor ---");

assert(math.maxADUFor(true, 32)  === 65535,      "float 32bit -> 65535");
assert(math.maxADUFor(true, 64)  === 65535,      "float 64bit -> 65535");
assert(math.maxADUFor(false, 32) === 4294967295, "int 32bit -> 4294967295");
assert(math.maxADUFor(false, 16) === 65535,      "int 16bit -> 65535");
assert(math.maxADUFor(false, 8)  === 65535,      "int 8bit -> 65535 (other)");

// ============================================================
// skyConditionLabel: not finite -> null
// ============================================================
console.log("\n--- skyConditionLabel (non-finite) ---");

assert(math.skyConditionLabel(NaN) === null,       "NaN -> null");
assert(math.skyConditionLabel(Infinity) === null,  "Infinity -> null");
assert(math.skyConditionLabel(-Infinity) === null, "-Infinity -> null");
assert(math.skyConditionLabel(undefined) === null, "undefined -> null");

// ============================================================
// countDistinctExposures
// ============================================================
console.log("\n--- countDistinctExposures ---");

assert(math.countDistinctExposures([]) === 0,                  "empty -> 0");
assert(math.countDistinctExposures([2, 2, 2]) === 1,           "[2,2,2] -> 1");
assert(math.countDistinctExposures([1, 1.0004, 2]) === 2,      "[1,1.0004,2] -> 2 (0.4 ms is the same)");
assert(math.countDistinctExposures([1, 1.001]) === 2,          "1 ms difference is distinct (boundary)");
assert(math.countDistinctExposures([1, 1.0009]) === 1,         "0.9 ms difference is the same");
assert(math.countDistinctExposures([8, 1, 4, 2, 1, 8]) === 4,  "unsorted with duplicates -> 4");
assert(math.countDistinctExposures([1, 1.0006, 1.0012]) === 2, "chain does not merge into one group");

// ============================================================
// angularSeparationArcsec
// ============================================================
console.log("\n--- angularSeparationArcsec ---");

assertClose(math.angularSeparationArcsec(10, 20, 10, 20), 0, 1e-9,   "same point -> 0");
assertClose(math.angularSeparationArcsec(10, 20, 10, 21), 3600, 0.01, "1 deg in Dec -> 3600 arcsec");
assertClose(math.angularSeparationArcsec(359.9, 0, 0.1, 0), 720, 0.01, "RA wraps around 0/360 at the equator");
assertClose(math.angularSeparationArcsec(0, 89.5, 180, 89.5), 3600, 0.01, "over the pole: 1 deg apart");
assertClose(math.angularSeparationArcsec(0, 90, 123, 90), 0, 1e-6,   "at the pole RA is irrelevant");
assertClose(math.angularSeparationArcsec(0, 60, 1, 60), 1800 * 1.0, 5, "1 deg RA at Dec 60 ≈ 0.5 deg");
assertClose(math.angularSeparationArcsec(0, 0, 180, 0), 648000, 0.01, "antipodal -> 180 deg");

// ============================================================
// isCfaFrame
// ============================================================
console.log("\n--- isCfaFrame ---");

assert(math.isCfaFrame(1, "RGGB") === true,    "1 channel + RGGB -> CFA");
assert(math.isCfaFrame(3, "RGGB") === false,   "3 channels + RGGB (debayered) -> not CFA");
assert(math.isCfaFrame(1, "") === false,       "1 channel, empty pattern -> mono");
assert(math.isCfaFrame(1, "   ") === false,    "1 channel, blank pattern -> mono");
assert(math.isCfaFrame(1, null) === false,     "1 channel, no keyword -> mono");

// ============================================================
// sqmFailureReason
// ============================================================
console.log("\n--- sqmFailureReason ---");

var okInfo = { nUsedStarFrames: 4, L_star: 100, L_sky: 5, L_prime_sky: 0.5, distinctExposures: 4 };
assert(math.sqmFailureReason(okInfo) === null, "valid info -> null");
function withInfo(over) {
    var o = {};
    for (var k in okInfo) o[k] = okInfo[k];
    for (var k2 in over) o[k2] = over[k2];
    return o;
}
var r1 = math.sqmFailureReason(withInfo({ nUsedStarFrames: 1 }));
assert(typeof r1 === "string" && r1.indexOf("Fewer than 2") === 0, "1 usable frame -> frames reason");
assert(math.sqmFailureReason(withInfo({ nUsedStarFrames: 2 })) === null, "2 usable frames -> ok (boundary)");
var r2 = math.sqmFailureReason(withInfo({ distinctExposures: 1 }));
assert(typeof r2 === "string" && r2.indexOf("same exposure") >= 0, "1 distinct exposure -> exposure reason");
var r3 = math.sqmFailureReason(withInfo({ L_star: 0 }));
assert(typeof r3 === "string" && r3.indexOf("star") >= 0, "L_star = 0 -> star reason");
assert(math.sqmFailureReason(withInfo({ L_star: -3 })) !== null, "L_star < 0 -> reason");
assert(math.sqmFailureReason(withInfo({ L_star: NaN })) !== null, "L_star NaN -> reason");
var r4 = math.sqmFailureReason(withInfo({ L_sky: 0, L_prime_sky: 0 }));
assert(typeof r4 === "string" && r4.indexOf("background") >= 0, "L_sky = 0 -> background reason");
assert(math.sqmFailureReason(withInfo({ L_sky: -1, L_prime_sky: -0.1 })) !== null, "L_sky < 0 -> reason");
assert(math.sqmFailureReason(withInfo({ nUsedStarFrames: 0, distinctExposures: 0, L_star: NaN })).indexOf("Fewer than 2") === 0,
    "frame shortage takes priority over other reasons");
var noInternal = [r1, r2, r3, r4].join(" ");
assert(!/L_star|L_sky|adu_/.test(noInternal), "reasons contain no internal variable names");

// ============================================================
// sigmaClippingStats: mean field
// ============================================================
console.log("\n--- sigmaClippingStats: mean ---");

var symData = [98, 99, 100, 101, 102];
var rSym = math.sigmaClippingStats(symData, 3, 10);
assertClose(rSym.mean, 100, 0.01, "symmetric data: mean = 100");
assertClose(rSym.median, 100, 0.01, "symmetric data: median = 100");

// With positive outliers clipped: need enough normal values for sigma to be tight
// normal=[97..103 x10] + [500, 1000]: std of normal ≈ 2, so 3σ ≈ 6 → clips 500, 1000
var dataWithOutlier = [98, 99, 100, 101, 102, 103, 97, 100, 101, 102, 500, 1000];
var rOut = math.sigmaClippingStats(dataWithOutlier, 3, 10);
assert(rOut.mean < 200, "outlier clipped: mean < 200 after clipping");
assert(rOut.count < dataWithOutlier.length, "outlier clipped: count reduced");

// SExtractor mode: 2.5*median - 1.5*mean
// For symmetric data: mode ≈ median ≈ mean
var modeSymm = 2.5 * rSym.median - 1.5 * rSym.mean;
assertClose(modeSymm, 100, 0.01, "SExtractor mode ≈ 100 for symmetric data");

// For data with bright stars (positive skew), mode < median
var skewedData = [98, 99, 100, 101, 102, 120, 150, 180]; // faint stars in annulus
var rSkew = math.sigmaClippingStats(skewedData, 3, 10);
var modeSkew = 2.5 * rSkew.median - 1.5 * rSkew.mean;
assert(modeSkew < rSkew.median, "SExtractor mode < median when bright stars present");

// ============================================================
// computeLStar: saturation frame exclusion
// ============================================================
console.log("\n--- computeLStar: saturation exclusion ---");

// MAX_SAT_FRACTION is the single source of truth for the exclusion threshold
// (issue #13: area-based fill-in for saturated pixels always underestimates
// flux, so any frame with a saturated pixel is excluded — threshold is 0).
assertClose(math.MAX_SAT_FRACTION, 0, 0, "MAX_SAT_FRACTION default is 0");

var framesWithSat = [
    { exptime: 1,  adu_star: 200000,   saturated_fraction: 0.00 },
    { exptime: 2,  adu_star: 400000,   saturated_fraction: 0.00 },
    { exptime: 4,  adu_star: 800000,   saturated_fraction: 0.05 },  // excluded (sat > 0)
    { exptime: 8,  adu_star: 1200000,  saturated_fraction: 0.45 },  // excluded (sat > 0)
    { exptime: 16, adu_star: 1200000,  saturated_fraction: 0.90 }   // excluded (sat > 0)
];

// Default satThreshold = MAX_SAT_FRACTION = 0: any frame with saturated_fraction > 0 is excluded
var starSat = math.computeLStar(framesWithSat);
assert(starSat.excluded_frames === 3, "3 frames excluded (sat > 0, new default threshold)");
assertClose(starSat.L_star, 200000, 1, "L_star correct with saturated frames excluded");
assertClose(starSat.r2, 1.0, 0.001, "R² = 1.0 with the 2 remaining unsaturated frames");

// saturated_fraction === 0 (exactly): not excluded, still used in the fit
// (already verified above: the 2 frames with saturated_fraction=0.00 both
// contributed to starSat's L_star/r2 — this test makes that explicit).
var framesExactlyZero = [
    { exptime: 1, adu_star: 200000, saturated_fraction: 0 },
    { exptime: 2, adu_star: 400000, saturated_fraction: 0 },
    { exptime: 4, adu_star: 800000, saturated_fraction: 0 }
];
var starExactlyZero = math.computeLStar(framesExactlyZero);
assert(starExactlyZero.excluded_frames === 0, "saturated_fraction=0 is never excluded");
assertClose(starExactlyZero.L_star, 200000, 1, "L_star correct when saturated_fraction=0 for all frames");

// Legacy/explicit threshold still works as an opt-in override (e.g. 0.3, the old default)
var starSatLegacyThreshold = math.computeLStar(framesWithSat, 0.3);
assert(starSatLegacyThreshold.excluded_frames === 2, "explicit threshold=0.3 excludes only sat > 0.3");

// Excluding down to < 2 usable frames → NaN
var framesMostlySat = [
    { exptime: 1, adu_star: 200000, saturated_fraction: 0.00 },
    { exptime: 2, adu_star: 400000, saturated_fraction: 0.05 },  // excluded
    { exptime: 4, adu_star: 800000, saturated_fraction: 0.10 }   // excluded
];
var starMostlySat = math.computeLStar(framesMostlySat);
assert(isNaN(starMostlySat.L_star), "fewer than 2 usable frames (default threshold): L_star = NaN");
assert(starMostlySat.excluded_frames === 2, "2 frames excluded, 1 remaining (< 2 needed)");

// No saturated_fraction field: treated as 0 (not excluded), independent of threshold
var framesNoSatField = [
    { exptime: 1,  adu_star: 200000 },
    { exptime: 2,  adu_star: 400000 },
    { exptime: 4,  adu_star: 800000 }
];
var starNoSat = math.computeLStar(framesNoSatField);
assert(starNoSat.excluded_frames === 0, "no excluded frames when saturated_fraction absent");
assertClose(starNoSat.L_star, 200000, 100, "L_star correct when no sat field");

// All frames saturated → NaN
var allSat = [
    { exptime: 1,  adu_star: 65535, saturated_fraction: 0.80 },
    { exptime: 2,  adu_star: 65535, saturated_fraction: 0.95 }
];
var starAllSat = math.computeLStar(allSat);
assert(isNaN(starAllSat.L_star), "all frames saturated: L_star = NaN");
assert(starAllSat.excluded_frames === 2, "all frames saturated: excluded_frames = 2");

// ============================================================
// significantPixelCentroid (issue #22)
// ============================================================
function makeStar(cx, cy, r, peak, sky) {
    var px = [];
    for (var y = 0; y < 40; y++) {
        for (var x = 0; x < 40; x++) {
            var dx = x + 0.5 - cx, dy = y + 0.5 - cy;
            if (dx * dx + dy * dy > r * r) continue;
            px.push({ x: x + 0.5, y: y + 0.5, v: sky + peak * Math.exp(-(dx * dx + dy * dy) / 4) });
        }
    }
    return px;
}
var cen = math.significantPixelCentroid(makeStar(20.3, 19.6, 15, 1000, 100), 100, 5);
assert(cen.ok, "centroid: bright synthetic star is detected");
assertClose(cen.x, 20.3, 0.05, "centroid: x recovered");
assertClose(cen.y, 19.6, 0.05, "centroid: y recovered");

var flat = math.significantPixelCentroid(makeStar(20, 20, 15, 0, 100), 100, 5);
assert(!flat.ok && flat.reason !== null, "centroid: no star -> not ok with a reason");

var faint = math.significantPixelCentroid(makeStar(20, 20, 15, 30, 100), 100, 5);
assert(!faint.ok, "centroid: 6 sigma peak is below the 10 sigma gate");

var hot = [{ x: 5.5, y: 5.5, v: 1000 }, { x: 6.5, y: 5.5, v: 100 }];
assert(!math.significantPixelCentroid(hot, 100, 5).ok, "centroid: a single hot pixel is rejected (fewer than 5 pixels)");
assert(!math.significantPixelCentroid([], 100, 5).ok, "centroid: empty input is not ok");
assert(!math.significantPixelCentroid(makeStar(20, 20, 15, 1000, 100), 100, 0).ok, "centroid: std = 0 is not ok");

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

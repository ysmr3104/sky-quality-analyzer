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
// choosePixelScale (issue #14)
// ============================================================
var W = math.PIXEL_SCALE_WARN_FRAC;
assert(W === 0.02, "pixelScale: warn threshold is 2%");

var c1 = math.choosePixelScale([3.8, 3.82, 3.81], [3.0, 3.0], 3.82);
assertClose(c1.scale, 3.81, 1e-9, "pixelScale: WCS wins over header and db (median)");
assert(c1.source === "wcs", "pixelScale: source is wcs");

var c2 = math.choosePixelScale([0, 3.82, 0], [3.0, 3.0, 3.0], 3.0);
assertClose(c2.scale, 3.82, 1e-9, "pixelScale: WCS on a single frame is still used");
assert(c2.source === "wcs", "pixelScale: partial WCS -> wcs");
assertClose(c2.spread, (3.82 - 3.0) / 3.82, 1e-9, "pixelScale: unsolved frames count with their header value in the spread");
assertClose(math.choosePixelScale([3.82], [], 0).spread, 0, 1e-12, "pixelScale: spread of one value is 0");

var c3 = math.choosePixelScale([0, 0], [2.75, 2.75, 0], 3.82);
assertClose(c3.scale, 2.75, 1e-9, "pixelScale: header when no WCS");
assert(c3.source === "header", "pixelScale: source is header");
assertClose(c3.dbMismatch, (3.82 - 2.75) / 3.82, 1e-9, "pixelScale: dbMismatch is relative to db");

var c4 = math.choosePixelScale([], [], 3.82);
assertClose(c4.scale, 3.82, 1e-9, "pixelScale: db when nothing else");
assert(c4.source === "db", "pixelScale: source is db");
assert(isNaN(c4.dbMismatch), "pixelScale: dbMismatch is NaN when source is db");
assertClose(c4.spread, 0, 1e-12, "pixelScale: spread is 0 for db");

var c5 = math.choosePixelScale([0], [0], 0);
assert(c5.scale === 0 && c5.source === "none", "pixelScale: nothing known -> 0 / none");
assert(isNaN(c5.dbMismatch), "pixelScale: dbMismatch NaN when none");
var c5b = math.choosePixelScale(undefined, [NaN, -1], -2);
assert(c5b.scale === 0 && c5b.source === "none", "pixelScale: NaN / negative / missing lists are ignored");

var c6 = math.choosePixelScale([3.82], [], 0);
assert(isNaN(c6.dbMismatch) && c6.source === "wcs", "pixelScale: dbMismatch NaN when db unknown");

// spread = (max - min) / median
var c7 = math.choosePixelScale([3.8, 4.0, 3.9], [], 0);
assertClose(c7.spread, 0.2 / 3.9, 1e-9, "pixelScale: spread = (max-min)/median");

// even count: median is the mean of the two middle values
var c8 = math.choosePixelScale([3.80, 3.84], [], 0);
assertClose(c8.scale, 3.82, 1e-9, "pixelScale: median of an even count is the mean of the middle two");

// One solved frame (3.82) among header-only frames of other equipment (2.75):
// scale stays with the solved group, but the frames disagree.
var c9 = math.choosePixelScale([3.82, 0, 0, 0, 0, 0], [3.82, 2.75, 2.75, 2.75, 2.75, 2.75], 0);
assertClose(c9.scale, 3.82, 1e-9, "pixelScale: mixed solved / unsolved keeps the WCS value");
assert(c9.source === "wcs", "pixelScale: mixed -> wcs");
assertClose(c9.spread, (3.82 - 2.75) / 3.82, 1e-9, "pixelScale: spread compares each frame's best value");
assert(c9.spread > W, "pixelScale: mixed equipment is flagged");

// Threshold: just below / above 2%
var below = math.choosePixelScale([3.82 * 1.019], [], 3.82);
var above = math.choosePixelScale([3.82 * 1.021], [], 3.82);
assert(!(below.dbMismatch > W), "pixelScale: 1.9% mismatch is not flagged");
assert(above.dbMismatch > W, "pixelScale: 2.1% mismatch is flagged");
var sBelow = math.choosePixelScale([100, 101.9], [], 0);
var sAbove = math.choosePixelScale([100, 102.5], [], 0);
assert(!(sBelow.spread > W), "pixelScale: spread 1.9% is not flagged");
assert(sAbove.spread > W, "pixelScale: spread 2.5% is flagged");

// ============================================================
// Atmospheric extinction (issue #12)
// ============================================================
// Expected values come from published examples (Meeus, Astronomical Algorithms
// 2nd ed.) and from Kasten & Young (1989), not from this implementation.
console.log("\n--- extinction: Julian Date / sidereal time / altitude ---");

// Meeus Example 7.a: 1957 October 4.81 -> JD 2436116.31
assertClose(math.julianDateFromMs(Date.UTC(1957, 9, 4) + 0.81 * 86400000), 2436116.31, 1e-6, "JD: Meeus 7.a (1957-10-04.81)");
// Unix epoch
assertClose(math.julianDateFromMs(0), 2440587.5, 1e-9, "JD: 1970-01-01T00:00:00Z");

// Meeus Example 12.a: 1987 April 10, 0h UT -> mean sidereal time 13h10m46.3668s
assertClose(math.gmstDegrees(2446895.5), (13 + 10 / 60 + 46.3668 / 3600) * 15, 1e-5, "GMST: Meeus 12.a");
assert(math.gmstDegrees(2446895.5) >= 0 && math.gmstDegrees(2400000.5) >= 0 && math.gmstDegrees(2400000.5) < 360,
    "GMST: always in [0, 360)");

// Meeus Example 13.b: Venus, 1987-04-10 19:21:00 UT, Washington (38d55m17s N,
// 77d03m56s W), alpha = 23h09m16.641s, delta = -6d43m11.61s -> h = 15.1249 deg.
// Meeus counts longitude west positive; here east is positive, so it is negative.
// Meeus uses the apparent sidereal time (nutation); the mean one differs by ~1",
// hence the 0.01 deg tolerance.
var venusMs = Date.UTC(1987, 3, 10, 19, 21, 0);
var venusJd = math.julianDateFromMs(venusMs);
assertClose(venusJd, 2446896.30625, 1e-6, "JD: 1987-04-10 19:21 UT");
var venusAlpha = (23 + 9 / 60 + 16.641 / 3600) * 15;
var venusDelta = -(6 + 43 / 60 + 11.61 / 3600);
var washLat = 38 + 55 / 60 + 17 / 3600;
var washLon = -(77 + 3 / 60 + 56 / 3600);
assertClose(math.altitudeDeg(venusAlpha, venusDelta, washLat, washLon, venusJd), 15.1249, 0.01,
    "altitude: Meeus 13.b (Venus from Washington)");
// Wrong sign of the longitude (west taken as east) must not give the same altitude
assert(Math.abs(math.altitudeDeg(venusAlpha, venusDelta, washLat, -washLon, venusJd) - 15.1249) > 1,
    "altitude: east/west sign matters");
// Sanity: a star on the celestial pole has altitude = latitude at any time
assertClose(math.altitudeDeg(0, 90, 40, 10, 2451545.0), 40, 1e-9, "altitude: celestial pole = latitude");

console.log("\n--- extinction: air mass (Kasten & Young 1989) ---");
assertClose(math.airmassKastenYoung(90), 0.9997, 0.0002, "airmass: zenith is about 1");
assertClose(math.airmassKastenYoung(30), 1.995, 0.002, "airmass: h=30 is about 2");
assert(isNaN(math.airmassKastenYoung(9.99)), "airmass: below 10 deg is NaN");
assert(isFinite(math.airmassKastenYoung(10)), "airmass: exactly 10 deg is computed");
assert(isNaN(math.airmassKastenYoung(-5)), "airmass: below the horizon is NaN");
assert(isNaN(math.airmassKastenYoung(NaN)), "airmass: NaN altitude is NaN");
assert(math.airmassKastenYoung(45) < math.airmassKastenYoung(20), "airmass: grows toward the horizon");

// Venus is at 15 deg in Meeus 13.b: above the 10 deg limit, so X is defined
var fa = math.frameAirmass(venusAlpha, venusDelta, { lat: washLat, lon: washLon }, venusMs);
assertClose(fa.altitude, 15.1249, 0.01, "frameAirmass: altitude");
assertClose(fa.airmass, math.airmassKastenYoung(fa.altitude), 1e-12, "frameAirmass: airmass from that altitude");
assert(isNaN(math.frameAirmass(venusAlpha, venusDelta, null, venusMs).airmass), "frameAirmass: no site -> NaN");
assert(isNaN(math.frameAirmass(venusAlpha, venusDelta, { lat: washLat, lon: washLon }, NaN).airmass), "frameAirmass: no time -> NaN");
assert(isNaN(math.frameAirmass(NaN, venusDelta, { lat: washLat, lon: washLon }, venusMs).airmass), "frameAirmass: no star -> NaN");
// Six hours later Venus has set from this site
var fb = math.frameAirmass(venusAlpha, venusDelta, { lat: washLat, lon: washLon }, venusMs + 6 * 3600000);
assert(fb.altitude < 10 && isNaN(fb.airmass), "frameAirmass: below 10 deg -> NaN");

console.log("\n--- extinction: correction amount ---");
assertClose(math.extinctionCorrectionMag(0.25, 1.6), 0.40, 1e-12, "correction: k=0.25, X=1.6 -> +0.40 mag");
assertClose(math.EXTINCTION_K_DEFAULT, 0.20, 0, "correction: default k is 0.20");

console.log("\n--- extinction: date strings ---");
var t0 = Date.UTC(2001, 1, 3, 4, 5, 6);   // 2001-02-03T04:05:06Z
assertClose(math.parseFitsDateTime("2001-02-03T04:05:06"), t0, 0, "date: no Z, no fraction");
assertClose(math.parseFitsDateTime("2001-02-03T04:05:06Z"), t0, 0, "date: with Z");
assertClose(math.parseFitsDateTime("2001-02-03T04:05:06.250"), t0 + 250, 0.5, "date: milliseconds");
assertClose(math.parseFitsDateTime("2001-02-03T04:05:06.250Z"), t0 + 250, 0.5, "date: milliseconds with Z");
assertClose(math.parseFitsDateTime("'2001-02-03T04:05:06'"), t0, 0, "date: quoted");
assertClose(math.parseFitsDateTime("2001-02-03 04:05:06"), t0, 0, "date: space instead of T");
assertClose(math.parseFitsDateTime("2001-02-03", "04:05:06"), t0, 0, "date: DATE-OBS + TIME-OBS");
assertClose(math.parseFitsDateTime("2001-02-03", "04:05:06.5"), t0 + 500, 0.5, "date: DATE-OBS + TIME-OBS with fraction");
assertClose(math.parseFitsDateTime("2001-02-03T04:05:06", "11:11:11"), t0, 0, "date: TIME-OBS ignored when DATE-OBS has a time");
assert(isNaN(math.parseFitsDateTime("2001-02-03")), "date: a date alone is not a time of exposure");
assert(isNaN(math.parseFitsDateTime("2001-02-30T00:00:00")), "date: 30 February is rejected");
assert(isNaN(math.parseFitsDateTime("2001-13-03T00:00:00")), "date: month 13 is rejected");
assert(isNaN(math.parseFitsDateTime("garbage")), "date: garbage");
assert(isNaN(math.parseFitsDateTime(null)), "date: null");
assert(isNaN(math.parseFitsDateTime("2001-02-03", "junk")), "date: bad TIME-OBS");

console.log("\n--- extinction: sexagesimal angles ---");
assertClose(math.parseSexagesimal("+38 55 17.0"), 38 + 55 / 60 + 17.0 / 3600, 1e-9, "angle: '+38 55 17.0'");
assertClose(math.parseSexagesimal("38:55:17"), 38 + 55 / 60 + 17 / 3600, 1e-9, "angle: '38:55:17'");
assertClose(math.parseSexagesimal("-38 55 17"), -(38 + 55 / 60 + 17 / 3600), 1e-9, "angle: negative");
assertClose(math.parseSexagesimal("-0 30 00"), -0.5, 1e-9, "angle: negative with zero degrees keeps the sign");
assertClose(math.parseSexagesimal("-12:30"), -12.5, 1e-9, "angle: degrees and minutes");
assertClose(math.parseSexagesimal("139.5"), 139.5, 1e-12, "angle: decimal");
assertClose(math.parseSexagesimal("-38.92"), -38.92, 1e-12, "angle: negative decimal");
assertClose(math.parseSexagesimal("'+35.1'"), 35.1, 1e-12, "angle: quoted decimal");
assertClose(math.parseSexagesimal("3.51E1"), 35.1, 1e-9, "angle: exponent");
assertClose(math.parseSexagesimal(12.5), 12.5, 0, "angle: number");
assert(isNaN(math.parseSexagesimal("")), "angle: empty");
assert(isNaN(math.parseSexagesimal("abc")), "angle: letters");
assert(isNaN(math.parseSexagesimal("33 61 00")), "angle: minutes >= 60");
assert(isNaN(math.parseSexagesimal("33 10 61")), "angle: seconds >= 60");
assert(isNaN(math.parseSexagesimal("1 2 3 4")), "angle: four fields");
assert(isNaN(math.parseSexagesimal(null)), "angle: null");

console.log("\n--- extinction: middle of the exposure (priority) ---");
var tA = "2001-02-03T04:00:00", tB = "2001-02-03T04:00:10";
var tAms = Date.UTC(2001, 1, 3, 4, 0, 0);
var mAvg = math.frameMidTime({ dateAvg: "2001-02-03T04:00:07", dateObs: tA, dateEnd: tB, exptime: 10 });
assertClose(mAvg.ms, Date.UTC(2001, 1, 3, 4, 0, 7), 0, "mid time: DATE-AVG comes first");
assert(mAvg.source === "DATE-AVG", "mid time: source DATE-AVG");
var mMid = math.frameMidTime({ dateObs: tA, dateEnd: tB, exptime: 4 });
assertClose(mMid.ms, tAms + 5000, 0, "mid time: midpoint of DATE-OBS and DATE-END (EXPTIME not used)");
assert(/midpoint/.test(mMid.source), "mid time: source midpoint");
var mBadAvg = math.frameMidTime({ dateAvg: "junk", dateObs: tA, dateEnd: tB, exptime: 10 });
assertClose(mBadAvg.ms, tAms + 5000, 0, "mid time: unreadable DATE-AVG falls through");
var mStart = math.frameMidTime({ dateObs: tA, dateObsComment: "Time of observation", exptime: 10 });
assertClose(mStart.ms, tAms + 5000, 0, "mid time: DATE-OBS is the start -> add half");
var mStart2 = math.frameMidTime({ dateObs: tA, exptime: 10 });
assertClose(mStart2.ms, tAms + 5000, 0, "mid time: no comment -> start");
var mEnd = math.frameMidTime({ dateObs: tB, dateObsComment: "Time end of exposure", exptime: 10 });
assertClose(mEnd.ms, tAms + 5000, 0, "mid time: comment says end -> subtract half");
var mEnd2 = math.frameMidTime({ dateObs: tB, dateObsComment: "END OF EXPOSURE", exptime: 10 });
assertClose(mEnd2.ms, tAms + 5000, 0, "mid time: 'end' matches in any case");
assert(/end of exposure/.test(mEnd.source), "mid time: source says end");
var mSplit = math.frameMidTime({ dateObs: "2001-02-03", timeObs: "04:00:00", exptime: 10 });
assertClose(mSplit.ms, tAms + 5000, 0, "mid time: DATE-OBS + TIME-OBS");
assert(math.frameMidTime({ dateObs: tA, exptime: NaN }) === null, "mid time: no EXPTIME and no DATE-END -> null");
assert(math.frameMidTime({ dateObs: "2001-02-03", exptime: 10 }) === null, "mid time: date only -> null");
assert(math.frameMidTime({ exptime: 10 }) === null, "mid time: nothing -> null");
// DATE-END earlier than DATE-OBS (a writer that puts the end in DATE-OBS) must not be averaged
var mOdd = math.frameMidTime({ dateObs: tB, dateObsComment: "Time end of exposure", dateEnd: tA, exptime: 10 });
assertClose(mOdd.ms, tAms + 5000, 0, "mid time: DATE-END before DATE-OBS is not used as a midpoint");

console.log("\n--- extinction: observing site (priority) ---");
var s1 = math.siteFromKeywords({ sitelat: "+38 55 17.0", sitelong: "-77 03 56", obsgeoB: "10", obsgeoL: "20" });
assert(s1 && s1.source === "SITELAT/SITELONG", "site: SITELAT/SITELONG comes first");
assertClose(s1.lat, 38 + 55 / 60 + 17.0 / 3600, 1e-9, "site: latitude from sexagesimal");
assertClose(s1.lon, -(77 + 3 / 60 + 56 / 3600), 1e-9, "site: longitude from sexagesimal");
var s2 = math.siteFromKeywords({ obsgeoB: "35.5", obsgeoL: "139.25" });
assert(s2 && s2.source === "OBSGEO-B/OBSGEO-L", "site: OBSGEO fallback");
assertClose(s2.lat, 35.5, 0, "site: OBSGEO latitude");
assertClose(s2.lon, 139.25, 0, "site: OBSGEO longitude");
var s3 = math.siteFromKeywords({ sitelat: "35.5", sitelong: "junk", obsgeoB: "10", obsgeoL: "20" });
assert(s3 && s3.source === "OBSGEO-B/OBSGEO-L", "site: a half-valid SITE pair falls through to OBSGEO");
assert(math.siteFromKeywords({ sitelat: "95", sitelong: "10" }) === null, "site: latitude out of range");
assert(math.siteFromKeywords({}) === null, "site: nothing -> null");
assert(math.siteFromKeywords({ obsgeoB: "10" }) === null, "site: latitude only -> null");
assertClose(math.siteFromKeywords({ obsgeoB: "10", obsgeoL: "250" }).lon, -110, 1e-9, "site: longitude 0..360 is folded");
assert(math.chooseSite(s1, { lat: 1, lon: 2 }) === s1, "chooseSite: header wins over manual entry");
var cs = math.chooseSite(null, { lat: 35.5, lon: 139.25 });
assert(cs && cs.source === "manual entry" && cs.lat === 35.5 && cs.lon === 139.25, "chooseSite: manual entry is the fallback");
assert(math.chooseSite(null, null) === null, "chooseSite: none");
assert(math.chooseSite(null, { lat: NaN, lon: 2 }) === null, "chooseSite: invalid manual entry");

console.log("\n--- extinction: summary and decision ---");
var sm = math.summarizeAirmass([1.2, NaN, 1.6, 1.4]);
assert(sm.count === 3, "summary: NaN values are left out");
assertClose(sm.mean, 1.4, 1e-12, "summary: mean");
assertClose(sm.min, 1.2, 0, "summary: min");
assertClose(sm.max, 1.6, 0, "summary: max");
assert(math.summarizeAirmass([NaN]).count === 0 && isNaN(math.summarizeAirmass([]).mean), "summary: nothing finite");

function ext(over) {
    var o = { enabled: true, k: 0.25, hasStar: true, airmasses: [1.5, 1.7], nWithTime: 2, nWithSite: 2 };
    for (var key in over) o[key] = over[key];
    return math.decideExtinction(o);
}
var dOk = ext({});
assert(dOk.corrected && dOk.reason === null, "decision: corrected when everything is known");
assertClose(dOk.correction, 0.25 * 1.6, 1e-12, "decision: correction = k * mean X");
assertClose(dOk.airmass.min, 1.5, 0, "decision: min X kept");
assertClose(dOk.airmass.max, 1.7, 0, "decision: max X kept");
assert(dOk.warnings.length === 0, "decision: no warning at low air mass");
assert(!ext({ enabled: false }).corrected && /turned off/.test(ext({ enabled: false }).reason), "decision: turned off");
assert(!ext({ hasStar: false }).corrected && /star/.test(ext({ hasStar: false }).reason), "decision: no star position");
var dNoTime = ext({ nWithTime: 0, airmasses: [NaN, NaN] });
assert(!dNoTime.corrected && /time of exposure/.test(dNoTime.reason), "decision: no time");
var dNoSite = ext({ nWithSite: 0, airmasses: [NaN, NaN] });
assert(!dNoSite.corrected && /observing site/.test(dNoSite.reason), "decision: no site");
var dNone = ext({ airmasses: [], nWithTime: 0, nWithSite: 0 });
assert(!dNone.corrected && /No frame was usable/.test(dNone.reason), "decision: no frame in the star fit");
var dLow = ext({ airmasses: [NaN, NaN] });
assert(!dLow.corrected && /10 degrees/.test(dLow.reason), "decision: below 10 deg in every frame");
assert(!ext({ k: NaN }).corrected, "decision: k not a number");
assert(!ext({ k: -0.1 }).corrected, "decision: negative k");
assert(ext({ k: 0 }).corrected && ext({ k: 0 }).correction === 0, "decision: k = 0 is allowed (no change)");
var dHigh = ext({ airmasses: [1.9, 2.3] });
assert(dHigh.corrected && dHigh.warnings.length === 1 && /low in the sky/.test(dHigh.warnings[0]), "decision: X > 2 warns but still corrects");
var dPart = ext({ airmasses: [1.5, NaN] });
assert(dPart.corrected && dPart.warnings.length === 1 && /1 of 2/.test(dPart.warnings[0]), "decision: partly known air mass warns");
assertClose(dPart.correction, 0.25 * 1.5, 1e-12, "decision: partly known uses the mean of the known ones");
// The corrected SQM is the raw one plus k * X, i.e. a larger number
var rawSqm = math.computeSQM(1000, 10, 2.0);
assert(rawSqm + dOk.correction > rawSqm, "decision: correction makes the SQM larger");

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

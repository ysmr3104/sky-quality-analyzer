#engine v8
// test_wcs_transform.js
// PJSR test: native astrometric solution (ImageWindow.celestialToImage /
// imageToCelestial) — verified against an independent criterion (does the
// projected position actually land on the star), not by round-tripping
// through the same transform.
//
// Run:
//   bash tests/pjsr/run_pjsr_tests.sh tests/pjsr/test_wcs_transform.js

var __SQA_LIBRARY_MODE = true;
#include "../../javascript/SkyQualityAnalyzer.js"
#include "pjsr_test_framework.js"

var PROJECT_ROOT = File.extractDrive(#__FILE__) + File.extractDirectory(#__FILE__) + "/../../";
var FIXTURE_DIR  = PROJECT_ROOT + "tests/fixtures/xisf/";
var RESULT_PATH  = PROJECT_ROOT + "tests/pjsr/results/test_wcs_transform_result.json";

// Kochab (beta UMi), J2000 catalog position — independent of anything the
// script itself computes.
var KOCHAB_RA  = 222.676357;
var KOCHAB_DEC = 74.155505;

var FRAME_1S = FIXTURE_DIR +
    "Light_Kochab_1.0s_Bin1_294MC_IRUV_gain120_20260327-000325_356deg_-10.0C_0005_c_d.xisf";
var FRAME_10S = FIXTURE_DIR +
    "Light_Kochab_10.0s_Bin1_294MC_IRUV_gain120_20260327-001000_359deg_-10.0C_0005_c_d.xisf";

var STAR_APERTURE = 15; // px, same as the script's default aperture radius

// Project Kochab's catalog RA/Dec onto the frame with celestialToImage(), then
// confirm the projected position actually sits on the star: the max G-channel
// (ch 1) value within STAR_APERTURE px must exceed the surrounding background
// annulus median by >= 0.5 (normalized pixel value, 0-1 range).
function assertStarAtProjectedPosition(filepath, label) {
    var wins = ImageWindow.open(filepath);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed: " + filepath);
    var win = wins[0];
    try {
        assertEqual(win.hasAstrometricSolution, true, label + ": hasAstrometricSolution should be true");

        var pt = win.celestialToImage(KOCHAB_RA, KOCHAB_DEC);
        assertTrue(pt !== null, label + ": celestialToImage returned null");
        log("  " + label + ": celestialToImage(Kochab) = ("
            + pt.x.toFixed(2) + ", " + pt.y.toFixed(2) + ")");

        var image = win.mainView.image;
        var ch = 1; // G channel
        var cx = pt.x;
        var cy = pt.y;
        var r  = STAR_APERTURE;

        // Aperture pixels (same PCL pixel-center convention as aperturePhotometry).
        var apVals = [];
        var yLo = Math.floor(cy - r) - 1, yHi = Math.ceil(cy + r) + 1;
        var xLo = Math.floor(cx - r) - 1, xHi = Math.ceil(cx + r) + 1;
        for (var y = yLo; y <= yHi; y++) {
            if (y < 0 || y >= image.height) continue;
            for (var x = xLo; x <= xHi; x++) {
                if (x < 0 || x >= image.width) continue;
                var dx = (x + 0.5) - cx;
                var dy = (y + 0.5) - cy;
                if (Math.sqrt(dx * dx + dy * dy) <= r) apVals.push(image.sample(x, y, ch));
            }
        }

        // Background annulus (same r_in/r_out as aperturePhotometry's default aperture).
        var rIn = r + 5, rOut = r + 25;
        var ringVals = [];
        var ryLo = Math.floor(cy - rOut) - 1, ryHi = Math.ceil(cy + rOut) + 1;
        var rxLo = Math.floor(cx - rOut) - 1, rxHi = Math.ceil(cx + rOut) + 1;
        for (var y = ryLo; y <= ryHi; y++) {
            if (y < 0 || y >= image.height) continue;
            for (var x = rxLo; x <= rxHi; x++) {
                if (x < 0 || x >= image.width) continue;
                var dx = (x + 0.5) - cx;
                var dy = (y + 0.5) - cy;
                var dist = Math.sqrt(dx * dx + dy * dy);
                if (dist >= rIn && dist <= rOut) ringVals.push(image.sample(x, y, ch));
            }
        }

        assertTrue(apVals.length > 0,   label + ": no aperture pixels sampled");
        assertTrue(ringVals.length > 0, label + ": no background ring pixels sampled");

        var maxVal = apVals[0];
        for (var i = 1; i < apVals.length; i++) {
            if (apVals[i] > maxVal) maxVal = apVals[i];
        }
        var bgMedian = median(ringVals);

        log("  " + label + ": max=" + maxVal.toFixed(5)
            + " bgMedian=" + bgMedian.toFixed(5) + " diff=" + (maxVal - bgMedian).toFixed(5));
        assertTrue(maxVal - bgMedian >= 0.5, label + ": max aperture value ("
            + maxVal.toFixed(5) + ") should exceed background median ("
            + bgMedian.toFixed(5) + ") by >= 0.5 — projected position should land on the star");
    } finally {
        win.forceClose();
    }
}

// ============================================================
// Off-center stars: celestialToImage() vs. a significant-pixels-only centroid
// ============================================================
// Kochab sits close to the frame center, where the retired linear TAN
// approximation was already fairly accurate (its error grows with distance
// from the tangent point), and where a flipped y axis barely moves anything
// (a flip maps y -> H-y, which is close to y itself when y is close to H/2).
// Neither the retired implementation nor a flipped y axis can be told apart
// from a correct one using only a star on the vertical center line. So this
// uses three isolated, unsaturated stars (SIMBAD J2000), one off to the side
// and one near each vertical edge:
var TEST_STARS = [
    {
        // V=6.681. No other V-magnitude star within 3' per SIMBAD. Projects to
        // (370,1414) — ~1700px to the left of the frame center (4144x2822,
        // center (2072,1411)), about 68% of the way to a corner. Measured
        // directly against the retired formula (its CRPIX/CRVAL/CD read from
        // the XISF header, before removal) it was projected 84px away from
        // where celestialToImage() puts it.
        name: "HD 136919",
        ra:  229.34424277666997,
        dec: 74.04514025971
    },
    {
        // V=7.63. Projects to (2108,356) — near the TOP edge (~356px from
        // it), with x close to the frame's x-center (2072), which isolates
        // the y axis from any x-direction effect.
        name: "HD 131710",
        ra:  222.58576789384,
        dec: 73.02778114665
    },
    {
        // V=7.99. Projects to (791,2715) — near the BOTTOM edge (~107px
        // from it).
        name: "TW UMi",
        ra:  228.21212036959997,
        dec: 75.47114969322
    }
];

// Background stats (mean, std) from a sigma-clipped annulus — std, not MAD,
// since the centroid below needs a real per-pixel noise estimate.
function backgroundStats(image, ch, cx, cy, rIn, rOut) {
    var vals = [];
    var yLo = Math.floor(cy - rOut) - 1, yHi = Math.ceil(cy + rOut) + 1;
    var xLo = Math.floor(cx - rOut) - 1, xHi = Math.ceil(cx + rOut) + 1;
    for (var y = yLo; y <= yHi; y++) {
        if (y < 0 || y >= image.height) continue;
        var py = y + 0.5;
        for (var x = xLo; x <= xHi; x++) {
            if (x < 0 || x >= image.width) continue;
            var px = x + 0.5;
            var dx = px - cx, dy = py - cy;
            var dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= rIn && dist <= rOut) vals.push(image.sample(x, y, ch));
        }
    }
    if (vals.length === 0) return null;
    return sigmaClippingStats(vals, 3.0, 10); // { median, mean, std, count }
}

// Centroid over pixels whose background-subtracted value exceeds 3*bgStd —
// i.e. only pixels that are actually part of a detected source, not every
// positive noise fluctuation in the window (a plain "subtract the background
// and keep positive values" centroid is biased toward the window's own
// center by symmetric noise, even with no star in the window at all).
// Also returns the raw peak value, so the caller can require a minimum
// detection significance separately.
function significantPixelCentroid(image, ch, cx, cy, r, bgMean, bgStd) {
    var wSum = 0, wxSum = 0, wySum = 0;
    var peak = -1;
    var yLo = Math.floor(cy - r) - 1, yHi = Math.ceil(cy + r) + 1;
    var xLo = Math.floor(cx - r) - 1, xHi = Math.ceil(cx + r) + 1;
    for (var y = yLo; y <= yHi; y++) {
        if (y < 0 || y >= image.height) continue;
        var py = y + 0.5;
        for (var x = xLo; x <= xHi; x++) {
            if (x < 0 || x >= image.width) continue;
            var px = x + 0.5;
            var dx = px - cx, dy = py - cy;
            if (dx * dx + dy * dy > r * r) continue;
            var v = image.sample(x, y, ch);
            if (v > peak) peak = v;
            if (bgStd <= 0) continue;
            var w = v - bgMean;
            if (w <= 3 * bgStd) continue; // keep only >3sigma pixels
            wSum  += w;
            wxSum += w * px;
            wySum += w * py;
        }
    }
    if (peak < 0 || wSum <= 0) return null;
    return { x: wxSum / wSum, y: wySum / wSum, peak: peak };
}

// Runs the significant-pixel centroid check at an explicit pixel center
// (rather than a star's celestialToImage() position), so the mutation test
// below can probe a deliberately wrong center without duplicating this logic.
// Returns { sigma, diffX, diffY } or null (no pixels 3sigma above background
// within the aperture at all).
function centroidCheckAt(image, ch, cx, cy, r) {
    var bg = backgroundStats(image, ch, cx, cy, r + 5, r + 25);
    if (!bg || bg.count === 0) return null;
    var result = significantPixelCentroid(image, ch, cx, cy, r, bg.mean, bg.std);
    if (!result) return null;
    var sigma = (bg.std > 0) ? (result.peak - bg.mean) / bg.std : NaN;
    return { sigma: sigma, diffX: result.x - cx, diffY: result.y - cy };
}

// 3px: the residual between celestialToImage()'s position and each star's
// actual pixel position (found via the significant-pixel centroid above) was
// <= 3px for all three stars in both exposures.
var CENTROID_TOLERANCE_PX = 3;
var MIN_DETECTION_SIGMA   = 5;

function assertProjectionMatchesCentroid(filepath, label, star) {
    var wins = ImageWindow.open(filepath);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed: " + filepath);
    var win = wins[0];
    try {
        assertEqual(win.hasAstrometricSolution, true, label + ": hasAstrometricSolution should be true");

        var pt = win.celestialToImage(star.ra, star.dec);
        assertTrue(pt !== null, label + ": celestialToImage returned null");
        log("  " + label + ": " + star.name + " celestialToImage = ("
            + pt.x.toFixed(2) + ", " + pt.y.toFixed(2) + ")");

        var image = win.mainView.image;
        var ch = 1; // G channel
        var check = centroidCheckAt(image, ch, pt.x, pt.y, STAR_APERTURE);
        assertTrue(check !== null, label + ": " + star.name
            + " — no pixels 3sigma above background within the aperture (no detectable star at the projected position)");

        log("  " + label + ": " + star.name + " sigma=" + check.sigma.toFixed(2)
            + " diff=(" + check.diffX.toFixed(2) + "," + check.diffY.toFixed(2) + ")");
        assertTrue(check.sigma >= MIN_DETECTION_SIGMA, label + ": " + star.name
            + " peak should be >= " + MIN_DETECTION_SIGMA + "sigma above background, got " + check.sigma.toFixed(2) + "sigma");
        assertTrue(Math.abs(check.diffX) <= CENTROID_TOLERANCE_PX, label + ": " + star.name
            + " centroid x should be within " + CENTROID_TOLERANCE_PX + "px of celestialToImage, diff=" + check.diffX.toFixed(2));
        assertTrue(Math.abs(check.diffY) <= CENTROID_TOLERANCE_PX, label + ": " + star.name
            + " centroid y should be within " + CENTROID_TOLERANCE_PX + "px of celestialToImage, diff=" + check.diffY.toFixed(2));
    } finally {
        win.forceClose();
    }
}

for (var _si = 0; _si < TEST_STARS.length; _si++) {
    (function(star) {
        test(star.name + ": celestialToImage matches significant-pixel centroid — 1s frame", function() {
            assertProjectionMatchesCentroid(FRAME_1S, "1s", star);
        });
        test(star.name + ": celestialToImage matches significant-pixel centroid — 10s frame", function() {
            assertProjectionMatchesCentroid(FRAME_10S, "10s", star);
        });
    })(TEST_STARS[_si]);
}

// Mutation test: a centroid check that only looks for *some* signal above
// background, with no minimum significance, would still "pass" on pure noise
// when centered 84px away from the real star (this repo's measured retired-
// implementation error for HD 136919, see TEST_STARS above) — the noise
// above the background threshold is roughly symmetric around any window
// center, including a wrong one, so the centroid lands back on the window
// center by construction. Confirm the actual check above doesn't do that:
// shifting HD 136919's projected position by (84, 0) must make it fail,
// either by finding no 3sigma signal, by failing the 5sigma detection
// requirement, or by landing outside the tolerance.
test("mutation: centroid check must fail when the center is wrong by (84, 0)", function() {
    var wins = ImageWindow.open(FRAME_10S);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed");
    var win = wins[0];
    try {
        var star = TEST_STARS[0]; // HD 136919
        var pt = win.celestialToImage(star.ra, star.dec);
        assertTrue(pt !== null, "celestialToImage returned null");
        var wrongX = pt.x + 84;
        var wrongY = pt.y;

        var image = win.mainView.image;
        var check = centroidCheckAt(image, 1, wrongX, wrongY, STAR_APERTURE);

        var failed;
        var reason;
        if (!check) {
            failed = true;
            reason = "no pixels 3sigma above background";
        } else if (check.sigma < MIN_DETECTION_SIGMA) {
            failed = true;
            reason = "sigma=" + check.sigma.toFixed(2) + " < " + MIN_DETECTION_SIGMA;
        } else if (Math.abs(check.diffX) > CENTROID_TOLERANCE_PX || Math.abs(check.diffY) > CENTROID_TOLERANCE_PX) {
            failed = true;
            reason = "diff=(" + check.diffX.toFixed(2) + "," + check.diffY.toFixed(2) + ") exceeds " + CENTROID_TOLERANCE_PX + "px";
        } else {
            failed = false;
            reason = "sigma=" + check.sigma.toFixed(2) + " diff=(" + check.diffX.toFixed(2) + "," + check.diffY.toFixed(2) + ")";
        }
        log("  wrong center=(" + wrongX.toFixed(2) + "," + wrongY.toFixed(2) + "): " + reason
            + " -> " + (failed ? "correctly failed" : "WRONGLY PASSED"));
        assertTrue(failed, "shifting the center by (84,0) should make the centroid check fail, but it passed: " + reason);
    } finally {
        win.forceClose();
    }
});

// Auxiliary: Kochab sits near the tangent point, so this only confirms a star
// is roughly where celestialToImage() says — see TEST_STARS above for the
// tests that can actually tell a wrong implementation from a correct one.
test("celestialToImage(Kochab) lands on the star — 1s frame", function() {
    assertStarAtProjectedPosition(FRAME_1S, "1s");
});

test("celestialToImage(Kochab) lands on the star — 10s frame", function() {
    assertStarAtProjectedPosition(FRAME_10S, "10s");
});

// Auxiliary: imageToCelestial() -> celestialToImage() should round-trip within 0.1 px.
test("imageToCelestial / celestialToImage round-trip within 0.1 px", function() {
    var wins = ImageWindow.open(FRAME_1S);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed");
    var win = wins[0];
    try {
        var origX = 500, origY = 800;
        var celestial = win.imageToCelestial(origX, origY);
        assertTrue(celestial !== null, "imageToCelestial returned null");
        var back = win.celestialToImage(celestial.x, celestial.y);
        assertTrue(back !== null, "celestialToImage returned null");
        log("  orig=(" + origX + "," + origY + ")"
            + "  celestial=(" + celestial.x.toFixed(4) + "," + celestial.y.toFixed(4) + ")"
            + "  back=(" + back.x.toFixed(2) + "," + back.y.toFixed(2) + ")");
        assertEqual(back.x, origX, "round-trip X", 0.1);
        assertEqual(back.y, origY, "round-trip Y", 0.1);
    } finally {
        win.forceClose();
    }
});

runAllTests(RESULT_PATH);

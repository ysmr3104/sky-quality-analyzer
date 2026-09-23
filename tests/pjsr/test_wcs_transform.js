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
// Off-center star: celestialToImage() vs. a background-subtracted centroid
// ============================================================
// Kochab sits close to the frame center, where the retired linear TAN
// approximation was already fairly accurate (its error grows with distance
// from the tangent point). It can't tell a correct implementation from that
// old, buggy one. HD 136919 (V=6.681, SIMBAD J2000, isolated — no other
// V-magnitude star within 3' per SIMBAD) sits ~1700 px from the frame center
// (4144x2822, center (2072,1411)) — about 68% of the way to a corner. Measured
// directly against the retired formula (its CRPIX/CRVAL/CD read from the XISF
// header, before removal) it was projected 84 px away from where
// celestialToImage() puts it; Kochab, near the tangent point, was off by only
// ~1 px by the same comparison.
var CORNER_STAR = {
    name: "HD 136919",
    ra:  229.34424277666997,
    dec: 74.04514025971
};

// A background-subtracted centroid can't itself be used as an exact ground
// truth here: the same ~5-8 px offset in y (celestialToImage vs. the actual
// pixel data) shows up not just for this star but also for Kochab near the
// frame center (projected (2086.6, 1414.9) vs. centroid (2087.1, 1407.3) in an
// initial check) — i.e. it looks like a roughly uniform shift across the
// whole frame rather than a distortion that grows toward the edges. The
// fixtures are real captures, not synthetic, but all 6 frames were re-saved
// together the day after capture (traces of a since-lost cropping script);
// the astrometric solution and the pixel data may not agree to better than a
// few px as a result. Root cause tracked in issue #22. Until that's resolved,
// 8 px is loose enough to absorb this whole-frame offset while still reliably
// catching the retired implementation's error at this star (84 px, above) —
// tighten it once #22 lands.
function backgroundSubtractedCentroid(image, ch, cx, cy, r, bgMedian) {
    var wSum = 0, wxSum = 0, wySum = 0;
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
            var w = image.sample(x, y, ch) - bgMedian;
            if (w <= 0) continue;
            wSum  += w;
            wxSum += w * px;
            wySum += w * py;
        }
    }
    if (wSum <= 0) return null;
    return { x: wxSum / wSum, y: wySum / wSum };
}

function annulusMedian(image, ch, cx, cy, rIn, rOut) {
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
    return median(vals);
}

var CENTROID_TOLERANCE_PX = 8; // see comment on CORNER_STAR above

function assertProjectionMatchesCentroid(filepath, label) {
    var wins = ImageWindow.open(filepath);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed: " + filepath);
    var win = wins[0];
    try {
        assertEqual(win.hasAstrometricSolution, true, label + ": hasAstrometricSolution should be true");

        var pt = win.celestialToImage(CORNER_STAR.ra, CORNER_STAR.dec);
        assertTrue(pt !== null, label + ": celestialToImage returned null");
        log("  " + label + ": " + CORNER_STAR.name + " celestialToImage = ("
            + pt.x.toFixed(2) + ", " + pt.y.toFixed(2) + ")");

        var image = win.mainView.image;
        var ch = 1; // G channel
        var r  = STAR_APERTURE;
        var bgMedian = annulusMedian(image, ch, pt.x, pt.y, r + 5, r + 25);
        var centroid = backgroundSubtractedCentroid(image, ch, pt.x, pt.y, r, bgMedian);
        assertTrue(centroid !== null, label + ": centroid had no signal above background");

        var diffX = centroid.x - pt.x;
        var diffY = centroid.y - pt.y;
        log("  " + label + ": centroid=(" + centroid.x.toFixed(2) + "," + centroid.y.toFixed(2) + ")"
            + " bgMedian=" + bgMedian.toFixed(5)
            + " diff=(" + diffX.toFixed(2) + "," + diffY.toFixed(2) + ")");
        assertTrue(Math.abs(diffX) <= CENTROID_TOLERANCE_PX, label + ": centroid x should be within "
            + CENTROID_TOLERANCE_PX + "px of celestialToImage, diff=" + diffX.toFixed(2));
        assertTrue(Math.abs(diffY) <= CENTROID_TOLERANCE_PX, label + ": centroid y should be within "
            + CENTROID_TOLERANCE_PX + "px of celestialToImage, diff=" + diffY.toFixed(2));
    } finally {
        win.forceClose();
    }
}

test(CORNER_STAR.name + ": celestialToImage matches background-subtracted centroid — 1s frame", function() {
    assertProjectionMatchesCentroid(FRAME_1S, "1s");
});

test(CORNER_STAR.name + ": celestialToImage matches background-subtracted centroid — 10s frame", function() {
    assertProjectionMatchesCentroid(FRAME_10S, "10s");
});

// Auxiliary: Kochab sits near the tangent point, so this only confirms a star
// is roughly where celestialToImage() says — see CORNER_STAR above for the
// test that can actually tell the retired implementation from a correct one.
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

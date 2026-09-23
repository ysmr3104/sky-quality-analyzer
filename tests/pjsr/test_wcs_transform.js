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

#engine v8
// test_aperture_photometry.js
// PJSR test: aperturePhotometry() accepts a fractional star center.
// A 0.3 px shift in the center should change the measured flux by <= 2%.
//
// Run:
//   bash tests/pjsr/run_pjsr_tests.sh tests/pjsr/test_aperture_photometry.js

var __SQA_LIBRARY_MODE = true;
#include "../../javascript/SkyQualityAnalyzer.js"
#include "pjsr_test_framework.js"

var PROJECT_ROOT = File.extractDrive(#__FILE__) + File.extractDirectory(#__FILE__) + "/../../";
var FIXTURE_DIR  = PROJECT_ROOT + "tests/fixtures/xisf/";
var RESULT_PATH  = PROJECT_ROOT + "tests/pjsr/results/test_aperture_photometry_result.json";

// Kochab (beta UMi), J2000
var KOCHAB_RA  = 222.676357;
var KOCHAB_DEC = 74.155505;

var FRAME_10S = FIXTURE_DIR +
    "Light_Kochab_10.0s_Bin1_294MC_IRUV_gain120_20260327-001000_359deg_-10.0C_0005_c_d.xisf";

var APERTURE = 15;

test("aperturePhotometry: flux changes <= 2% for a 0.3 px center shift", function() {
    var meta = readFrameMetadata(FRAME_10S);
    assertTrue(meta !== null, "readFrameMetadata returned null");

    // Find the star's integer pixel center via the native astrometric solution.
    var wins = ImageWindow.open(FRAME_10S);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed");
    var win = wins[0];
    var center;
    try {
        assertEqual(win.hasAstrometricSolution, true, "hasAstrometricSolution should be true");
        var pt = win.celestialToImage(KOCHAB_RA, KOCHAB_DEC);
        assertTrue(pt !== null, "celestialToImage returned null");
        center = { x: Math.round(pt.x), y: Math.round(pt.y) };
    } finally {
        win.forceClose();
    }
    log("  star center (integer) = (" + center.x + ", " + center.y + ")");

    var apInt = aperturePhotometry(FRAME_10S, center.x, center.y, APERTURE, meta.bitsPerSample, "G", null);
    assertTrue(apInt !== null, "aperturePhotometry (integer center) returned null");

    var apShifted = aperturePhotometry(FRAME_10S, center.x + 0.3, center.y, APERTURE, meta.bitsPerSample, "G", null);
    assertTrue(apShifted !== null, "aperturePhotometry (shifted center) returned null");

    assertTrue(!isNaN(apInt.adu_star) && apInt.adu_star > 0, "integer-center flux should be positive");
    assertTrue(!isNaN(apShifted.adu_star) && apShifted.adu_star > 0, "shifted-center flux should be positive");

    var diffPct = Math.abs(apShifted.adu_star - apInt.adu_star) / apInt.adu_star * 100;
    log("  flux(int)=" + apInt.adu_star.toFixed(1)
        + "  flux(+0.3px)=" + apShifted.adu_star.toFixed(1)
        + "  diff=" + diffPct.toFixed(3) + "%");
    assertTrue(diffPct <= 2.0, "flux difference for a 0.3 px center shift should be <= 2%, got "
        + diffPct.toFixed(3) + "%");
});

test("aperturePhotometry: starRaDec overrides starX/starY with the WCS-projected position", function() {
    var meta = readFrameMetadata(FRAME_10S);
    assertTrue(meta !== null, "readFrameMetadata returned null");

    var wins = ImageWindow.open(FRAME_10S);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed");
    var win = wins[0];
    var expectedPt;
    try {
        assertEqual(win.hasAstrometricSolution, true, "hasAstrometricSolution should be true");
        expectedPt = win.celestialToImage(KOCHAB_RA, KOCHAB_DEC);
        assertTrue(expectedPt !== null, "celestialToImage returned null");
    } finally {
        win.forceClose();
    }
    log("  expected projected center = (" + expectedPt.x.toFixed(4) + ", " + expectedPt.y.toFixed(4) + ")");

    var starRaDec = { ra: KOCHAB_RA, dec: KOCHAB_DEC };
    // Deliberately pass a wrong fallback center (0, 0). If starRaDec is actually
    // honored, this fallback is never used and the result still lands on the star.
    var apViaRaDec = aperturePhotometry(FRAME_10S, 0, 0, APERTURE, meta.bitsPerSample, "G", starRaDec);
    assertTrue(apViaRaDec !== null, "aperturePhotometry (via starRaDec) returned null");

    // (a) returned starX/starY should match celestialToImage() within 0.01 px.
    log("  (a) apViaRaDec.starX/Y = (" + apViaRaDec.starX.toFixed(4) + ", " + apViaRaDec.starY.toFixed(4) + ")");
    assertEqual(apViaRaDec.starX, expectedPt.x, "(a) returned starX should match celestialToImage", 0.01);
    assertEqual(apViaRaDec.starY, expectedPt.y, "(a) returned starY should match celestialToImage", 0.01);

    // (b) adu_star should match a direct call using that same center (no starRaDec),
    // to within a relative 1e-9 — i.e. the starRaDec path isn't computing anything
    // differently from just being handed the right coordinates.
    var apDirect = aperturePhotometry(FRAME_10S, expectedPt.x, expectedPt.y, APERTURE, meta.bitsPerSample, "G", null);
    assertTrue(apDirect !== null, "aperturePhotometry (direct center) returned null");

    var relDiff = Math.abs(apViaRaDec.adu_star - apDirect.adu_star) / Math.abs(apDirect.adu_star);
    log("  (b) adu_star via starRaDec=" + apViaRaDec.adu_star.toFixed(6)
        + "  via direct center=" + apDirect.adu_star.toFixed(6)
        + "  relDiff=" + relDiff.toExponential(3));
    assertTrue(relDiff <= 1e-9, "(b) adu_star should match the direct-center call to within a relative 1e-9, got "
        + relDiff.toExponential(3));
});

runAllTests(RESULT_PATH);

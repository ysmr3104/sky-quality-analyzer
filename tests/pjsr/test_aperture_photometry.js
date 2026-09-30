#engine v8
// test_aperture_photometry.js
// PJSR test: aperturePhotometry() accepts a fractional star center.
// A 0.3 px shift in the center should change the measured flux by <= 2%.
// Since issue #22 the center is re-centroided on the star before measuring
// (refineStarCenter), so the tests below also cover that.
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

// HD 136919 (V=6.68, not saturated), same coordinates as TEST_STARS[0] in test_wcs_transform.js
var HD_RA  = 229.34424277666997;
var HD_DEC = 74.04514025971;

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

    var apInt = aperturePhotometry(FRAME_10S, center.x, center.y, APERTURE, "G", null);
    assertTrue(apInt !== null, "aperturePhotometry (integer center) returned null");

    var apShifted = aperturePhotometry(FRAME_10S, center.x + 0.3, center.y, APERTURE, "G", null);
    assertTrue(apShifted !== null, "aperturePhotometry (shifted center) returned null");

    assertTrue(!isNaN(apInt.adu_star) && apInt.adu_star > 0, "integer-center flux should be positive");
    assertTrue(!isNaN(apShifted.adu_star) && apShifted.adu_star > 0, "shifted-center flux should be positive");

    // Both starts are pulled to the star's centroid, so they should land together.
    log("  measured center (int)=(" + apInt.starX.toFixed(3) + ", " + apInt.starY.toFixed(3) + ")"
        + "  (+0.3px)=(" + apShifted.starX.toFixed(3) + ", " + apShifted.starY.toFixed(3) + ")");
    assertTrue(Math.abs(apShifted.starX - apInt.starX) < 0.3 && Math.abs(apShifted.starY - apInt.starY) < 0.3,
        "both starting points should converge to the same star center within 0.3 px");
    var diffPct = Math.abs(apShifted.adu_star - apInt.adu_star) / apInt.adu_star * 100;
    log("  flux(int)=" + apInt.adu_star.toFixed(1)
        + "  flux(+0.3px)=" + apShifted.adu_star.toFixed(1)
        + "  diff=" + diffPct.toFixed(3) + "%");
    assertTrue(diffPct <= 2.0, "flux difference for a 0.3 px center shift should be <= 2%, got "
        + diffPct.toFixed(3) + "%");
});

test("aperturePhotometry: starRaDec overrides starX/starY; projectedX/Y is the WCS position, starX/Y the re-centered one", function() {
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
    var apViaRaDec = aperturePhotometry(FRAME_10S, 0, 0, APERTURE, "G", starRaDec);
    assertTrue(apViaRaDec !== null, "aperturePhotometry (via starRaDec) returned null");

    // (a) projectedX/projectedY should match celestialToImage() within 0.01 px;
    // starX/starY is the re-centered position, a few px at most from it.
    log("  (a) apViaRaDec.projectedX/Y = (" + apViaRaDec.projectedX.toFixed(4) + ", " + apViaRaDec.projectedY.toFixed(4) + ")"
        + "  starX/Y = (" + apViaRaDec.starX.toFixed(4) + ", " + apViaRaDec.starY.toFixed(4) + ")"
        + "  shift=" + apViaRaDec.centroidShift.toFixed(3) + " px  refined=" + apViaRaDec.centroidRefined);
    assertEqual(apViaRaDec.projectedX, expectedPt.x, "(a) projectedX should match celestialToImage", 0.01);
    assertEqual(apViaRaDec.projectedY, expectedPt.y, "(a) projectedY should match celestialToImage", 0.01);
    assertTrue(apViaRaDec.centroidRefined === true, "(a) Kochab should be re-centered");
    assertTrue(Math.abs(apViaRaDec.starX - expectedPt.x) <= 3 && Math.abs(apViaRaDec.starY - expectedPt.y) <= 3,
        "(a) re-centered position should be within 3 px of the projection");

    // (b) adu_star should match a direct call using that same center (no starRaDec),
    // to within a relative 1e-9 — i.e. the starRaDec path isn't computing anything
    // differently from just being handed the right coordinates.
    var apDirect = aperturePhotometry(FRAME_10S, expectedPt.x, expectedPt.y, APERTURE, "G", null);
    assertTrue(apDirect !== null, "aperturePhotometry (direct center) returned null");

    var relDiff = Math.abs(apViaRaDec.adu_star - apDirect.adu_star) / Math.abs(apDirect.adu_star);
    log("  (b) adu_star via starRaDec=" + apViaRaDec.adu_star.toFixed(6)
        + "  via direct center=" + apDirect.adu_star.toFixed(6)
        + "  relDiff=" + relDiff.toExponential(3));
    assertTrue(relDiff <= 1e-9, "(b) adu_star should match the direct-center call to within a relative 1e-9, got "
        + relDiff.toExponential(3));
});

// ============================================================
// aperturePhotometry: saturated pixels are summed (not excluded/scaled), issue #13.
// Kochab's 10s frame saturates at the star core. adu_star must equal the sum of
// ALL aperture pixels (including saturated ones) minus skyBg * pixel count —
// verified here by independently re-summing the aperture pixels, so this test
// does not just re-check the production code against itself.
// ============================================================
test("aperturePhotometry: saturated pixels included in flux sum (issue #13)", function() {
    var meta = readFrameMetadata(FRAME_10S);
    assertTrue(meta !== null, "readFrameMetadata returned null");

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

    var ap = aperturePhotometry(FRAME_10S, center.x, center.y, APERTURE, "G", null);
    assertTrue(ap !== null, "aperturePhotometry returned null");
    log("  saturated_pixels=" + ap.saturated_pixels
        + "  saturated_fraction=" + (ap.saturated_fraction * 100).toFixed(2) + "%"
        + "  skyBg=" + ap.skyBg.toFixed(2)
        + "  adu_star=" + ap.adu_star.toFixed(1));
    assertTrue(ap.saturated_pixels > 0,
        "Kochab 10s frame should have saturated pixels in the aperture, got " + ap.saturated_pixels);

    // Independently re-sum every pixel inside the same aperture circle (including
    // saturated ones) and subtract skyBg * pixel count, using the exact same
    // center/geometry convention as aperturePhotometry() (pixel (ix,iy) center =
    // (ix+0.5, iy+0.5)), but computed here from scratch rather than by calling
    // production helper functions.
    var wins2 = ImageWindow.open(FRAME_10S);
    assertTrue(wins2 && wins2.length > 0, "ImageWindow.open failed (2nd open)");
    var win2   = wins2[0];
    var image2 = win2.mainView.image;
    var maxADU = maxADUFor(image2.isReal, image2.bitsPerSample); // same scale as the production code
    var ch     = 1; // "G" channel of a color image, matching aperturePhotometry's convention

    var cx = ap.starX;
    var cy = ap.starY;
    var independentSum   = 0;
    var independentCount = 0;
    var independentSat   = 0; // counted here on the normalized value, not via maxADU

    try {
        var yLo = Math.floor(cy - APERTURE) - 1;
        var yHi = Math.ceil(cy + APERTURE) + 1;
        var xLo = Math.floor(cx - APERTURE) - 1;
        var xHi = Math.ceil(cx + APERTURE) + 1;
        for (var y = yLo; y <= yHi; y++) {
            if (y < 0 || y >= image2.height) continue;
            var py = y + 0.5;
            for (var x = xLo; x <= xHi; x++) {
                if (x < 0 || x >= image2.width) continue;
                var px = x + 0.5;
                var dx = px - cx;
                var dy = py - cy;
                if (dx * dx + dy * dy <= APERTURE * APERTURE) {
                    independentCount++;
                    var v = image2.sample(x, y, ch);
                    if (v >= 0.97) independentSat++; // SAT_THRESHOLD as a normalized value
                    independentSum += v * maxADU;
                }
            }
        }
    } finally {
        win2.forceClose();
    }

    var independentNetFlux = independentSum - ap.skyBg * independentCount;
    log("  independent: saturated=" + independentSat + "  (aperturePhotometry: " + ap.saturated_pixels + ")");
    assertEqual(ap.saturated_pixels, independentSat,
        "saturated_pixels should equal an independent count of pixels >= 0.97 (normalized)");
    log("  independent: count=" + independentCount + "  sum=" + independentSum.toFixed(1)
        + "  netFlux=" + independentNetFlux.toFixed(1));
    assertEqual(ap.adu_star, independentNetFlux, "adu_star should equal independently-summed "
        + "(all aperture pixels) - skyBg * count", 0.5);
});

// ============================================================
// refineStarCenter (issue #22)
// ============================================================

// Open FRAME_10S, project (ra, dec), and call refineStarCenter at the projected
// position shifted by (dx, dy). Returns { proj, res }.
function refineAt(ra, dec, dx, dy) {
    var wins = ImageWindow.open(FRAME_10S);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed");
    var win = wins[0];
    try {
        assertEqual(win.hasAstrometricSolution, true, "hasAstrometricSolution should be true");
        var pt = safeCelestialToImage(win, ra, dec);
        assertTrue(pt !== null, "safeCelestialToImage returned null");
        var res = refineStarCenter(win.mainView.image, 1, pt.x + dx, pt.y + dy, APERTURE);
        return { proj: pt, res: res };
    } finally {
        win.forceClose();
    }
}

function fmtRes(r) {
    return "refined=" + r.refined + " (" + r.x.toFixed(3) + ", " + r.y.toFixed(3) + ") shift="
        + r.shift.toFixed(3) + " reason=" + r.reason;
}

test("refineStarCenter: HD 136919 offset by (+4, -3) px lands where the unshifted call does", function() {
    var base    = refineAt(HD_RA, HD_DEC, 0, 0);
    var shifted = refineAt(HD_RA, HD_DEC, 4, -3);
    log("  unshifted: " + fmtRes(base.res) + "  projected=(" + base.proj.x.toFixed(3) + ", " + base.proj.y.toFixed(3) + ")");
    log("  (+4,-3)  : " + fmtRes(shifted.res));
    assertTrue(base.res.refined === true, "unshifted call should be refined");
    assertTrue(shifted.res.refined === true, "shifted call should be refined, reason: " + shifted.res.reason);
    var d = Math.sqrt(Math.pow(shifted.res.x - base.res.x, 2) + Math.pow(shifted.res.y - base.res.y, 2));
    log("  distance between the two refined centers = " + d.toFixed(3) + " px");
    assertTrue(d <= 0.5, "refined centers should agree within 0.5 px, got " + d.toFixed(3));
});

test("refineStarCenter: HD 136919 offset by (+20, 0) px (star outside the window) is not refined", function() {
    var r = refineAt(HD_RA, HD_DEC, 20, 0);
    log("  (+20,0)  : " + fmtRes(r.res) + "  projected=(" + r.proj.x.toFixed(3) + ", " + r.proj.y.toFixed(3) + ")");
    assertTrue(r.res.refined === false, "should not be refined");
    assertTrue(typeof r.res.reason === "string" && r.res.reason.length > 0, "a reason should be given");
    assertEqual(r.res.x, r.proj.x + 20, "x should stay at the input position", 1e-9);
    assertEqual(r.res.y, r.proj.y, "y should stay at the input position", 1e-9);
    assertEqual(r.res.shift, 0, "shift should be 0", 1e-9);
});

test("refineStarCenter: Kochab (saturated) is refined by <= 3 px", function() {
    var r = refineAt(KOCHAB_RA, KOCHAB_DEC, 0, 0);
    log("  Kochab   : " + fmtRes(r.res) + "  projected=(" + r.proj.x.toFixed(3) + ", " + r.proj.y.toFixed(3) + ")");
    assertTrue(r.res.refined === true, "should be refined, reason: " + r.res.reason);
    assertTrue(r.res.shift <= 3, "shift should be <= 3 px, got " + r.res.shift.toFixed(3));
});

test("aperturePhotometry: starX/Y equal refineStarCenter's result, projectedX/Y equal celestialToImage (HD 136919)", function() {
    var ref = refineAt(HD_RA, HD_DEC, 0, 0);
    var ap = aperturePhotometry(FRAME_10S, 0, 0, APERTURE, "G", { ra: HD_RA, dec: HD_DEC });
    assertTrue(ap !== null, "aperturePhotometry returned null");
    log("  ap: projected=(" + ap.projectedX.toFixed(4) + ", " + ap.projectedY.toFixed(4) + ")  star=("
        + ap.starX.toFixed(4) + ", " + ap.starY.toFixed(4) + ")  shift=" + ap.centroidShift.toFixed(3)
        + "  refined=" + ap.centroidRefined + "  adu_star=" + ap.adu_star.toFixed(1));
    assertEqual(ap.projectedX, ref.proj.x, "projectedX should match celestialToImage", 1e-6);
    assertEqual(ap.projectedY, ref.proj.y, "projectedY should match celestialToImage", 1e-6);
    assertEqual(ap.starX, ref.res.x, "starX should match refineStarCenter", 1e-6);
    assertEqual(ap.starY, ref.res.y, "starY should match refineStarCenter", 1e-6);
    assertEqual(ap.centroidRefined, true, "centroidRefined");
    assertTrue(ap.adu_star > 0, "HD 136919 flux should be positive");
});

// All six Kochab frames, as runAnalysis() would measure them (projection via each
// frame's own solution). Records how far each frame's star was moved.
test("aperturePhotometry: all Kochab frames are re-centered by <= 3 px", function() {
    var names = [
        "Light_Kochab_1.0s_Bin1_294MC_IRUV_gain120_20260327-000325_356deg_-10.0C_0005_c_d.xisf",
        "Light_Kochab_2.0s_Bin1_294MC_IRUV_gain120_20260327-000418_356deg_-10.0C_0005_c_d.xisf",
        "Light_Kochab_4.0s_Bin1_294MC_IRUV_gain120_20260327-000520_356deg_-10.0C_0005_c_d.xisf",
        "Light_Kochab_6.0s_Bin1_294MC_IRUV_gain120_20260327-000631_356deg_-10.0C_0005_c_d.xisf",
        "Light_Kochab_8.0s_Bin1_294MC_IRUV_gain120_20260327-000808_356deg_-10.0C_0005_c_d.xisf",
        "Light_Kochab_10.0s_Bin1_294MC_IRUV_gain120_20260327-001000_359deg_-10.0C_0005_c_d.xisf"
    ];
    for (var i = 0; i < names.length; i++) {
        var ap = aperturePhotometry(FIXTURE_DIR + names[i], 0, 0, APERTURE, "G", { ra: KOCHAB_RA, dec: KOCHAB_DEC });
        assertTrue(ap !== null, "aperturePhotometry returned null for " + names[i]);
        log("  " + names[i].substring(0, 20) + "  projected=(" + ap.projectedX.toFixed(2) + ", " + ap.projectedY.toFixed(2)
            + ")  star=(" + ap.starX.toFixed(2) + ", " + ap.starY.toFixed(2) + ")  shift=" + ap.centroidShift.toFixed(2)
            + " px  refined=" + ap.centroidRefined + "  sat=" + ap.saturated_pixels);
        assertTrue(ap.centroidRefined === true, "should be re-centered: " + names[i] + " reason: " + ap.centroidReason);
        assertTrue(ap.centroidShift <= 3, "shift should be <= 3 px, got " + ap.centroidShift.toFixed(2));
    }
});

runAllTests(RESULT_PATH);

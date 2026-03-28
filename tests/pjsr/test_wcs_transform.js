// test_wcs_transform.js
// PJSR test: raDecToPixel() / pixelToRaDec() — WCS round-trip using real frame WCS
//
// Run:
//   bash tests/pjsr/run_pjsr_tests.sh tests/pjsr/test_wcs_transform.js

var __SQA_LIBRARY_MODE = true;
#include "../../javascript/SkyQualityAnalyzer.js"
#include "pjsr_test_framework.js"

var PROJECT_ROOT = File.extractDrive(#__FILE__) + File.extractDirectory(#__FILE__) + "/../../";
var FIXTURE_DIR  = PROJECT_ROOT + "tests/fixtures/xisf/";
var RESULT_PATH  = PROJECT_ROOT + "tests/pjsr/results/test_wcs_transform_result.json";

// Use the 1s frame (plate-solved, WCS in binary XISF header)
var FRAME_1S = FIXTURE_DIR +
    "Light_Kochab_1.0s_Bin1_294MC_IRUV_gain120_20260327-000325_356deg_-10.0C_0005_c_d.xisf";

// ============================================================
// Load WCS from the 1s frame
// ============================================================
var wcs = null;

test("readFrameMetadata: WCS present in 1s frame", function() {
    var meta = readFrameMetadata(FRAME_1S);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    assertTrue(meta.wcs !== null, "WCS should be present in plate-solved XISF");
    wcs = meta.wcs;
    console.writeln("  CRPIX1=" + wcs.crpix1.toFixed(1) + " CRPIX2=" + wcs.crpix2.toFixed(1));
    console.writeln("  CRVAL1=" + wcs.crval1.toFixed(4) + " CRVAL2=" + wcs.crval2.toFixed(4));
    console.writeln("  CD1_1=" + wcs.cd11.toFixed(6) + " CD2_2=" + wcs.cd22.toFixed(6));
});

// ============================================================
// Round-trip: pixel → RA/Dec → pixel (CRPIX should map to CRVAL)
// ============================================================
// CRPIX is a FITS 1-indexed coordinate.
// PixInsight pixel corresponding to CRPIX:
//   px_pi = crpix1 - 1          (x: FITS 1-indexed → PixInsight 0-indexed)
//   py_pi = imageHeight - crpix2 (y: FITS y-up → PixInsight y-down)
test("pixelToRaDec(CRPIX) returns CRVAL", function() {
    assertTrue(wcs !== null, "WCS not loaded (previous test failed)");
    var crPixPx = wcs.crpix1 - 1;
    var crPixPy = wcs.imageHeight - wcs.crpix2;
    var pos = pixelToRaDec(wcs, crPixPx, crPixPy);
    assertTrue(pos !== null, "pixelToRaDec returned null");
    console.writeln("  CRPIX in PI coords: px=" + crPixPx.toFixed(1) + " py=" + crPixPy.toFixed(1));
    console.writeln("  pixelToRaDec(CRPIX): RA=" + pos.ra.toFixed(4) + " Dec=" + pos.dec.toFixed(4));
    assertEqual(pos.ra,  wcs.crval1, "RA at CRPIX should equal CRVAL1",  0.01);
    assertEqual(pos.dec, wcs.crval2, "Dec at CRPIX should equal CRVAL2", 0.01);
});

test("raDecToPixel(CRVAL) returns CRPIX", function() {
    assertTrue(wcs !== null, "WCS not loaded (previous test failed)");
    var px = raDecToPixel(wcs, wcs.crval1, wcs.crval2);
    assertTrue(px !== null, "raDecToPixel returned null");
    console.writeln("  raDecToPixel(CRVAL): px=" + px.px.toFixed(1) + " py=" + px.py.toFixed(1));
    // Expected PixInsight pixel for CRPIX:
    //   px_expected = round(crpix1 - 1),  py_expected = round(imageHeight - crpix2)
    var expPx = Math.round(wcs.crpix1 - 1);
    var expPy = Math.round(wcs.imageHeight - wcs.crpix2);
    assertEqual(px.px, expPx, "px at CRVAL should equal CRPIX1 - 1", 1.0);
    assertEqual(px.py, expPy, "py at CRVAL should equal imageHeight - CRPIX2", 1.0);
});

// ============================================================
// Round-trip: arbitrary pixel → RA/Dec → pixel
// ============================================================
test("raDecToPixel(pixelToRaDec(px)) round-trip", function() {
    assertTrue(wcs !== null, "WCS not loaded (previous test failed)");
    var origX = 500;
    var origY = 800;
    var pos = pixelToRaDec(wcs, origX, origY);
    assertTrue(pos !== null, "pixelToRaDec returned null");
    var back = raDecToPixel(wcs, pos.ra, pos.dec);
    assertTrue(back !== null, "raDecToPixel returned null");
    console.writeln("  orig=(" + origX + "," + origY + ")"
        + "  pos=(" + pos.ra.toFixed(4) + "," + pos.dec.toFixed(4) + ")"
        + "  back=(" + back.px.toFixed(1) + "," + back.py.toFixed(1) + ")");
    assertEqual(back.px, origX, "round-trip X", 1.0);
    assertEqual(back.py, origY, "round-trip Y", 1.0);
});

runAllTests(RESULT_PATH);

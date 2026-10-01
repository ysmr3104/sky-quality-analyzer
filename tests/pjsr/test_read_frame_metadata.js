#engine v8
// test_read_frame_metadata.js
// PJSR test: readFrameMetadata() — EXPTIME, isColor, WCS loading from XISF files
//
// Run:
//   bash tests/pjsr/run_pjsr_tests.sh tests/pjsr/test_read_frame_metadata.js

var __SQA_LIBRARY_MODE = true;
#include "../../javascript/SkyQualityAnalyzer.js"
#include "pjsr_test_framework.js"

var PROJECT_ROOT = File.extractDrive(#__FILE__) + File.extractDirectory(#__FILE__) + "/../../";
var FIXTURE_DIR  = PROJECT_ROOT + "tests/fixtures/xisf/";
var RESULT_PATH  = PROJECT_ROOT + "tests/pjsr/results/test_read_frame_metadata_result.json";

// Expected values derived from the Kochab test frames (ASI294MC Pro, debayered)
var FIXTURES = [
    { file: "Light_Kochab_1.0s_Bin1_294MC_IRUV_gain120_20260327-000325_356deg_-10.0C_0005_c_d.xisf",  exptime: 1.0  },
    { file: "Light_Kochab_2.0s_Bin1_294MC_IRUV_gain120_20260327-000418_356deg_-10.0C_0005_c_d.xisf",  exptime: 2.0  },
    { file: "Light_Kochab_4.0s_Bin1_294MC_IRUV_gain120_20260327-000520_356deg_-10.0C_0005_c_d.xisf",  exptime: 4.0  },
    { file: "Light_Kochab_6.0s_Bin1_294MC_IRUV_gain120_20260327-000631_356deg_-10.0C_0005_c_d.xisf",  exptime: 6.0  },
    { file: "Light_Kochab_8.0s_Bin1_294MC_IRUV_gain120_20260327-000808_356deg_-10.0C_0005_c_d.xisf",  exptime: 8.0  },
    { file: "Light_Kochab_10.0s_Bin1_294MC_IRUV_gain120_20260327-001000_359deg_-10.0C_0005_c_d.xisf", exptime: 10.0 }
];

// ============================================================
// readFrameMetadata: exptime
// ============================================================
for (var i = 0; i < FIXTURES.length; i++) {
    (function(fx) {
        test("readFrameMetadata: exptime=" + fx.exptime + "s", function() {
            var meta = readFrameMetadata(FIXTURE_DIR + fx.file);
            assertTrue(meta !== null, "readFrameMetadata returned null");
            assertEqual(meta.exptime, fx.exptime, "exptime", 0.001);
        });
    })(FIXTURES[i]);
}

// ============================================================
// readFrameMetadata: isColor (debayered RGB = true)
// ============================================================
test("readFrameMetadata: isColor=true for debayered XISF", function() {
    var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    assertTrue(meta.isColor, "debayered XISF should be isColor=true");
});

// ============================================================
// readFrameMetadata: hasWcs — native astrometric solution flag
// ============================================================
test("readFrameMetadata: hasWcs=true for plate-solved XISF", function() {
    var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    assertEqual(meta.hasWcs, true, "hasWcs should be true for a plate-solved WBPP frame");
});

// ============================================================
// readFrameMetadata: isReal / isCfa
// ============================================================
test("readFrameMetadata: isCfa=false for debayered 3-channel XISF (BAYERPAT may remain)", function() {
    // Record whether the fixture really carries BAYERPAT, so this test shows
    // whether it exercised the channel-count branch or just a missing keyword.
    var wins = ImageWindow.open(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(wins && wins.length > 0, "ImageWindow.open failed");
    var bayer = null;
    try {
        bayer = getFITSKeyword(wins[0].keywords, "BAYERPAT");
    } finally {
        wins[0].forceClose();
    }
    log("  fixture BAYERPAT raw value = " + (bayer === null ? "(absent)" : bayer));

    var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    assertEqual(meta.isCfa, false, "debayered 3-channel frame must not be flagged as CFA");
});

// A real CFA path through readFrameMetadata(): write a 1-channel image with a
// quoted BAYERPAT (as capture software writes it) to a temporary XISF, read it
// back, and expect isCfa = true. Also check the 1-channel image without the
// keyword stays a normal (mono) frame.
function writeTempFrame(path, withBayer) {
    var w = new ImageWindow(64, 48, 1, 32, true, false, "sqa_cfa_probe");
    try {
        var kws = [ new FITSKeyword("EXPTIME", "2.0", "Exposure time [s]") ];
        if (withBayer) kws.push(new FITSKeyword("BAYERPAT", "'RGGB'", "Bayer pattern"));
        w.keywords = kws;
        assertTrue(w.saveAs(path, false, false, false, false), "saveAs failed: " + path);
    } finally {
        w.forceClose();
    }
}

test("readFrameMetadata: isCfa=true for a 1-channel frame with BAYERPAT='RGGB'", function() {
    var path = File.systemTempDirectory + "/sqa_cfa_probe.xisf";
    writeTempFrame(path, true);
    try {
        var meta = readFrameMetadata(path);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        log("  1-channel + BAYERPAT: isCfa=" + meta.isCfa);
        assertEqual(meta.isCfa, true, "1-channel frame with BAYERPAT must be flagged as CFA");
    } finally {
        if (File.exists(path)) File.remove(path);
    }
});

test("readFrameMetadata: isCfa=false for a 1-channel frame without BAYERPAT (mono)", function() {
    var path = File.systemTempDirectory + "/sqa_mono_probe.xisf";
    writeTempFrame(path, false);
    try {
        var meta = readFrameMetadata(path);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        log("  1-channel, no BAYERPAT: isCfa=" + meta.isCfa + "  exptime=" + meta.exptime);
        assertEqual(meta.isCfa, false, "mono frame must not be flagged as CFA");
    } finally {
        if (File.exists(path)) File.remove(path);
    }
});

test("readFrameMetadata: isReal=true for the floating-point Kochab frames", function() {
    var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    log("  isReal=" + meta.isReal + "  bitsPerSample=" + meta.bitsPerSample);
    assertEqual(meta.isReal, true, "isReal should be true");
});

// ============================================================
// readFrameMetadata: wcsPixelScale / headerPixelScale (issue #14)
// ============================================================
test("readFrameMetadata: wcsPixelScale is about 3.82 arcsec/px for the Kochab frames", function() {
    // Nominal: ASI294MC 4.63 um + RedCat 51 250 mm = 3.82 arcsec/px
    for (var i = 0; i < FIXTURES.length; i++) {
        var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[i].file);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        log("  " + FIXTURES[i].exptime + "s: wcsPixelScale=" + meta.wcsPixelScale
            + "  headerPixelScale=" + meta.headerPixelScale);
        assertTrue(isFinite(meta.wcsPixelScale), "wcsPixelScale must be finite");
        assertEqual(meta.wcsPixelScale, 3.82, "wcsPixelScale", 3.82 * 0.03);
    }
});

test("readFrameMetadata: headerPixelScale agrees with wcsPixelScale within 2% when the header has XPIXSZ/FOCALLEN", function() {
    var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    if (!(meta.headerPixelScale > 0)) {
        log("  fixture has no usable XPIXSZ/FOCALLEN: headerPixelScale=" + meta.headerPixelScale + " (nothing to compare)");
        return;
    }
    var rel = Math.abs(meta.headerPixelScale - meta.wcsPixelScale) / meta.wcsPixelScale;
    log("  header=" + meta.headerPixelScale + "  wcs=" + meta.wcsPixelScale + "  relative difference=" + rel);
    assertTrue(rel <= 0.02, "header and WCS pixel scales differ by more than 2%");
});

// XPIXSZ=2.0 um, FOCALLEN=150 mm, XBINNING=2, no astrometric solution:
// 2.0 / 150 * 206.265 = 2.750 arcsec/px. XBINNING must NOT be multiplied in
// (XPIXSZ already includes it), so 5.500 would be wrong.
test("readFrameMetadata: headerPixelScale ignores XBINNING; wcsPixelScale is 0 without a solution", function() {
    var path = File.systemTempDirectory + "/sqa_header_scale_probe.xisf";
    var w = new ImageWindow(64, 48, 1, 32, true, false, "sqa_header_scale_probe");
    try {
        w.keywords = [
            new FITSKeyword("EXPTIME", "2.0", "Exposure time [s]"),
            new FITSKeyword("XPIXSZ", "2.0", "Pixel size [um], binning included"),
            new FITSKeyword("FOCALLEN", "150", "Focal length [mm]"),
            new FITSKeyword("XBINNING", "2", "Binning")
        ];
        assertTrue(w.saveAs(path, false, false, false, false), "saveAs failed: " + path);
    } finally {
        w.forceClose();
    }
    try {
        var meta = readFrameMetadata(path);
        assertTrue(meta !== null, "readFrameMetadata returned null");
        log("  headerPixelScale=" + meta.headerPixelScale + "  wcsPixelScale=" + meta.wcsPixelScale + "  hasWcs=" + meta.hasWcs);
        assertEqual(meta.headerPixelScale, 2.750, "headerPixelScale", 0.001);
        assertEqual(meta.wcsPixelScale, 0, "wcsPixelScale without a solution", 0);
    } finally {
        if (File.exists(path)) File.remove(path);
    }
});

runAllTests(RESULT_PATH);

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
// readFrameMetadata: WCS loaded from XISF binary header
// ============================================================
test("readFrameMetadata: WCS loaded (CRPIX1, CRVAL1, CD1_1 not NaN)", function() {
    var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    assertTrue(meta.wcs !== null, "WCS should be present in plate-solved XISF");
    assertTrue(!isNaN(meta.wcs.crpix1), "crpix1 should not be NaN");
    assertTrue(!isNaN(meta.wcs.crval1), "crval1 should not be NaN");
    assertTrue(!isNaN(meta.wcs.cd11),   "cd11 should not be NaN");
});

// ============================================================
// readFrameMetadata: imageHeight stored in WCS
// ============================================================
test("readFrameMetadata: wcs.imageHeight > 0", function() {
    var meta = readFrameMetadata(FIXTURE_DIR + FIXTURES[0].file);
    assertTrue(meta !== null, "readFrameMetadata returned null");
    assertTrue(meta.wcs !== null, "WCS should be present");
    assertTrue(meta.wcs.imageHeight > 0, "wcs.imageHeight should be > 0");
});

runAllTests(RESULT_PATH);

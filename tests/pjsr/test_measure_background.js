// test_measure_background.js
// PJSR test: measureBackground() and computeLSky()
// Uses Kochab test frames (2026-03-27). Background ROI from kochab log: (2922, 1519).
//
// Run:
//   bash tests/pjsr/run_pjsr_tests.sh tests/pjsr/test_measure_background.js

var __SQA_LIBRARY_MODE = true;
#include "../../javascript/SkyQualityAnalyzer.js"
#include "pjsr_test_framework.js"

var PROJECT_ROOT = File.extractDrive(#__FILE__) + File.extractDirectory(#__FILE__) + "/../../";
var FIXTURE_DIR  = PROJECT_ROOT + "tests/fixtures/xisf/";
var RESULT_PATH  = PROJECT_ROOT + "tests/pjsr/results/test_measure_background_result.json";

var FRAMES = [
    { file: "Light_Kochab_1.0s_Bin1_294MC_IRUV_gain120_20260327-000325_356deg_-10.0C_0005_c_d.xisf",  exptime: 1.0  },
    { file: "Light_Kochab_2.0s_Bin1_294MC_IRUV_gain120_20260327-000418_356deg_-10.0C_0005_c_d.xisf",  exptime: 2.0  },
    { file: "Light_Kochab_4.0s_Bin1_294MC_IRUV_gain120_20260327-000520_356deg_-10.0C_0005_c_d.xisf",  exptime: 4.0  },
    { file: "Light_Kochab_6.0s_Bin1_294MC_IRUV_gain120_20260327-000631_356deg_-10.0C_0005_c_d.xisf",  exptime: 6.0  },
    { file: "Light_Kochab_8.0s_Bin1_294MC_IRUV_gain120_20260327-000808_356deg_-10.0C_0005_c_d.xisf",  exptime: 8.0  },
    { file: "Light_Kochab_10.0s_Bin1_294MC_IRUV_gain120_20260327-001000_359deg_-10.0C_0005_c_d.xisf", exptime: 10.0 }
];

// Background ROI from kochab log (2026-03-27 14:00, R²_sky=0.99882)
var BG_X = 2922;
var BG_Y = 1519;

// ============================================================
// measureBackground: returns positive ADU for each frame
// ============================================================
for (var i = 0; i < FRAMES.length; i++) {
    (function(fx) {
        test("measureBackground: positive ADU at " + fx.exptime + "s", function() {
            var meta = readFrameMetadata(FIXTURE_DIR + fx.file);
            assertTrue(meta !== null, "readFrameMetadata returned null");
            var bg = measureBackground(FIXTURE_DIR + fx.file, BG_X, BG_Y, meta.bitsPerSample, "G");
            assertTrue(bg !== null, "measureBackground returned null");
            assertTrue(bg.adu_sky > 0, "adu_sky should be positive, got " + bg.adu_sky);
        });
    })(FRAMES[i]);
}

// ============================================================
// measureBackground: ADU scales roughly linearly with exptime
// (ratio between 8s and 1s should be close to 8)
// ============================================================
test("measureBackground: ADU scales linearly with exptime (8s / 1s ≈ 8)", function() {
    var meta1 = readFrameMetadata(FIXTURE_DIR + FRAMES[0].file);
    var meta8 = readFrameMetadata(FIXTURE_DIR + FRAMES[4].file);
    var bg1 = measureBackground(FIXTURE_DIR + FRAMES[0].file, BG_X, BG_Y, meta1.bitsPerSample, "G");
    var bg8 = measureBackground(FIXTURE_DIR + FRAMES[4].file, BG_X, BG_Y, meta8.bitsPerSample, "G");
    assertTrue(bg1 !== null && bg8 !== null, "measureBackground returned null");
    var ratio = bg8.adu_sky / bg1.adu_sky;
    console.writeln("  bg1=" + bg1.adu_sky.toFixed(1) + "  bg8=" + bg8.adu_sky.toFixed(1) + "  ratio=" + ratio.toFixed(2));
    assertTrue(ratio > 5.0 && ratio < 11.0, "8s/1s ADU ratio should be ~8, got " + ratio.toFixed(2));
});

// ============================================================
// computeLSky: R² > 0.99 with all 6 frames
// ============================================================
test("computeLSky: R² > 0.99 with 6 Kochab frames", function() {
    var skyFrames = [];
    for (var i = 0; i < FRAMES.length; i++) {
        var meta = readFrameMetadata(FIXTURE_DIR + FRAMES[i].file);
        assertTrue(meta !== null, "readFrameMetadata returned null for frame " + i);
        var bg = measureBackground(FIXTURE_DIR + FRAMES[i].file, BG_X, BG_Y, meta.bitsPerSample, "G");
        assertTrue(bg !== null, "measureBackground returned null for frame " + i);
        skyFrames.push({ exptime: meta.exptime, adu_sky: bg.adu_sky });
    }
    var sky = computeLSky(skyFrames);
    console.writeln("  L_sky=" + sky.L_sky.toFixed(2) + "  R²=" + sky.r2.toFixed(5));
    assertTrue(sky.L_sky > 0,  "L_sky should be positive");
    assertTrue(sky.r2  > 0.99, "R²_sky should be > 0.99, got " + sky.r2.toFixed(5));
});

runAllTests(RESULT_PATH);

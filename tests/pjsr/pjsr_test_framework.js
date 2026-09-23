// pjsr_test_framework.js
// PJSR（PixInsight JavaScript Runtime）用テストフレームワーク
//
// 使い方:
//   var __SQA_LIBRARY_MODE = true;
//   #include "../../javascript/SkyQualityAnalyzer.js"
//   #include "pjsr_test_framework.js"
//
//   test("2+2は4", function() {
//       assertEqual(2 + 2, 4, "加算");
//   });
//
//   runAllTests(PROJECT_ROOT + "tests/pjsr/results/my_result.json");
//
// ログ:
//   outputPath と同じディレクトリに <テスト名>.log が生成される。
//   中身は log() で書いた行だけ（console.writeln は差し替えられないため）

(function() {

var _tests = [];
var _passed = 0;
var _failed = 0;
var _errors = [];
var _logLines = [];

var _logPath = null;

// V8 ランタイムの console.writeln は書き換え不可（writable: false）で、
// 代入は例外も出ずに無視される（1.9.4 で実測）。差し替えで出力を集める方式は
// 使えないので、テストは値を log() で残すこと。スクリプト本体の console 出力は
// ログファイルに入らない（PixInsight の Process Console にだけ出る）。

/**
 * ログファイルとコンソールの両方に 1 行書く。
 * runAllTests() の実行中は、呼ばれるたびにログファイルを書き直す（逐次書き出し）。
 * 途中で例外や強制終了があっても、そこまでの行が残る。
 */
function log(msg) {
    var s = String(msg === undefined ? "" : msg);
    _logLines.push(s);
    console.writeln(s);
    if (_logPath !== null) {
        File.writeTextFile(_logPath, _logLines.join("\n") + "\n");
    }
}

/**
 * テストを登録する
 * @param {string} name  テスト名
 * @param {function} fn  テスト本体（例外をスローすると失敗）
 */
function test(name, fn) {
    _tests.push({ name: name, fn: fn });
}

/**
 * 値が等しいことをアサートする（数値の場合は tolerance 内）
 * @param {*}      actual
 * @param {*}      expected
 * @param {string} msg        エラーメッセージ（省略可）
 * @param {number} tolerance  許容誤差（省略時 0）
 */
function assertEqual(actual, expected, msg, tolerance) {
    var tol = (typeof tolerance === "number") ? tolerance : 0;
    var ok;
    if (typeof expected === "number" && typeof actual === "number") {
        ok = Math.abs(actual - expected) <= tol;
    } else {
        ok = (actual === expected);
    }
    if (!ok) {
        var detail = (msg ? msg + ": " : "") +
            "expected=" + JSON.stringify(expected) +
            " actual=" + JSON.stringify(actual);
        throw new Error("assertEqual failed: " + detail);
    }
}

/**
 * 値が true であることをアサートする
 */
function assertTrue(val, msg) {
    if (!val) {
        throw new Error("assertTrue failed: " + (msg || JSON.stringify(val)));
    }
}

/**
 * 値が false であることをアサートする
 */
function assertFalse(val, msg) {
    if (val) {
        throw new Error("assertFalse failed: " + (msg || JSON.stringify(val)));
    }
}

/**
 * 全テストを実行し、結果を JSON ファイルとログファイルに書き出す
 * @param {string} outputPath  結果JSONファイルのフルパス
 *                             ログは同ディレクトリに <basename>.log として出力
 */
function runAllTests(outputPath) {
    _passed = 0;
    _failed = 0;
    _errors = [];

    // 結果ディレクトリとログのパスを先に決める（log() が逐次書き出せるように）
    var dir = File.extractDrive(outputPath) + File.extractDirectory(outputPath);
    if (!File.directoryExists(dir)) {
        File.createDirectory(dir, true);
    }
    // File.extractDirectory() の戻り値は末尾に "/" が付かない
    var baseName = File.extractName(outputPath);  // e.g. "test_foo_result"
    _logPath = dir + "/" + baseName.replace(/_result$/, "") + ".log";
    var pending = _logLines;   // runAllTests() より前に log() された行も残す
    _logLines = [];
    for (var p = 0; p < pending.length; p++) log(pending[p]);

    log("=== PJSR Test Framework ===");
    log("Total tests: " + _tests.length);
    log("---------------------------");

    for (var i = 0; i < _tests.length; i++) {
        var t = _tests[i];
        try {
            t.fn();
            _passed++;
            log("  PASS: " + t.name);
        } catch (e) {
            _failed++;
            var errMsg = (e && e.message) ? e.message : String(e);
            _errors.push({ name: t.name, error: errMsg });
            log("  FAIL: " + t.name);
            log("    " + errMsg);
        }
    }

    log("---------------------------");
    log("passed=" + _passed + "  failed=" + _failed);
    log("===========================");

    // 結果をJSONに書き出す
    var result = {
        total:  _tests.length,
        passed: _passed,
        failed: _failed,
        errors: _errors
    };
    var f = new File();
    f.createForWriting(outputPath);
    f.outText(JSON.stringify(result, null, 2));
    f.close();
    log("Result written to: " + outputPath);

    log("Log written to: " + _logPath);
    _logPath = null;
}

// グローバルに公開
this.test        = test;
this.assertEqual = assertEqual;
this.assertTrue  = assertTrue;
this.assertFalse = assertFalse;
this.runAllTests = runAllTests;
this.log         = log;

}).call(this);

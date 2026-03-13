"""Tests for select_best.py."""

import json
import os
import tempfile

from placement.select_best import load_results, score_variant, select_best


class TestScoreVariant:
    def test_basic_scoring(self):
        result = {
            "via_count": 10,
            "trace_length_mm": 500.0,
            "drc_warnings": 2,
        }
        weights = {"via_count": 1.0, "trace_length_mm": 0.1,
                    "drc_warnings": 0.5}
        score = score_variant(result, weights)
        # 10*1.0 + 500*0.1 + 2*0.5 = 10 + 50 + 1 = 61
        assert score == 61.0

    def test_zero_warnings(self):
        result = {"via_count": 5, "trace_length_mm": 100.0, "drc_warnings": 0}
        weights = {"via_count": 1.0, "trace_length_mm": 0.1,
                    "drc_warnings": 0.5}
        score = score_variant(result, weights)
        assert score == 15.0  # 5 + 10 + 0


class TestLoadResults:
    def test_loads_existing_results(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            data = {"status": "pass", "via_count": 10}
            path = os.path.join(tmpdir, "control-variant-a-result.json")
            with open(path, "w") as f:
                json.dump(data, f)

            results = load_results(tmpdir, "control", ["variant-a"])
            assert len(results) == 1
            assert results[0][0] == "variant-a"
            assert results[0][1]["status"] == "pass"

    def test_missing_result_treated_as_failure(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            results = load_results(tmpdir, "control", ["missing-variant"])
            assert len(results) == 1
            assert results[0][1]["status"] == "fail"


class TestSelectBest:
    def _write_result(self, tmpdir, board, variant, result):
        path = os.path.join(tmpdir, f"{board}-{variant}-result.json")
        with open(path, "w") as f:
            json.dump(result, f)
        # Also create dummy placed/routed PCBs
        for suffix in [".kicad_pcb", "-routed.kicad_pcb"]:
            with open(os.path.join(tmpdir,
                                   f"{board}-{variant}{suffix}"), "w") as f:
                f.write("dummy")

    def test_selects_lowest_score(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self._write_result(tmpdir, "control", "a", {
                "status": "pass", "via_count": 20,
                "trace_length_mm": 500.0, "drc_warnings": 0,
                "unconnected_count": 0,
            })
            self._write_result(tmpdir, "control", "b", {
                "status": "pass", "via_count": 10,
                "trace_length_mm": 400.0, "drc_warnings": 0,
                "unconnected_count": 0,
            })
            result = select_best(tmpdir, "control", ["a", "b"])
            assert result is not None
            winner, score = result
            assert winner == "b"  # fewer vias + shorter trace

    def test_disqualifies_unconnected(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self._write_result(tmpdir, "control", "good", {
                "status": "pass", "via_count": 50,
                "trace_length_mm": 1000.0, "drc_warnings": 5,
                "unconnected_count": 0,
            })
            self._write_result(tmpdir, "control", "bad", {
                "status": "pass", "via_count": 5,
                "trace_length_mm": 100.0, "drc_warnings": 0,
                "unconnected_count": 1,  # disqualified
            })
            result = select_best(tmpdir, "control", ["good", "bad"])
            assert result is not None
            winner, _ = result
            assert winner == "good"

    def test_disqualifies_failed_status(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self._write_result(tmpdir, "control", "good", {
                "status": "pass", "via_count": 20,
                "trace_length_mm": 500.0, "drc_warnings": 0,
                "unconnected_count": 0,
            })
            self._write_result(tmpdir, "control", "fail", {
                "status": "fail", "reason": "routing timeout",
            })
            result = select_best(tmpdir, "control", ["good", "fail"])
            winner, _ = result
            assert winner == "good"

    def test_all_fail_returns_none(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self._write_result(tmpdir, "control", "a", {
                "status": "fail", "reason": "crash",
            })
            self._write_result(tmpdir, "control", "b", {
                "status": "pass", "unconnected_count": 3,
            })
            result = select_best(tmpdir, "control", ["a", "b"])
            assert result is None

    def test_copies_winner_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self._write_result(tmpdir, "main", "best", {
                "status": "pass", "via_count": 5,
                "trace_length_mm": 100.0, "drc_warnings": 0,
                "unconnected_count": 0,
            })
            select_best(tmpdir, "main", ["best"])
            assert os.path.exists(
                os.path.join(tmpdir, "main-placed.kicad_pcb"))
            assert os.path.exists(
                os.path.join(tmpdir, "main-routed.kicad_pcb"))

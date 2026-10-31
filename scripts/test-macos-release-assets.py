#!/usr/bin/env python3
"""Isolated compatibility regression: exact architecture/version, unchanged bytes."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("assets", Path(__file__).with_name("macos-release-assets.py"))
assets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assets)


class CompatibilityTests(unittest.TestCase):
    def metadata(self, *names):
        return {"tag_name": "v2.5.47", "assets": [{"name": n} for n in names]}

    def test_selects_current_version_and_architecture_with_both_macs_present(self):
        names = [n for arch in ["aarch64", "x64"] for n in assets.names("2.5.47", arch).values()]
        names += list(assets.names("2.5.46", "x64").values())
        for arch in ["aarch64", "x64"]:
            self.assertEqual(assets.select(self.metadata(*names), "2.5.47", arch), assets.names("2.5.47", arch))

    def test_supports_both_existing_intel_updater_spellings(self):
        for updater in ["Clash.Verge_x64.app.tar.gz", "Clash.Verge.app.tar.gz"]:
            selected = assets.select(self.metadata("Clash.Verge_2.5.47_x64.dmg", updater, updater + ".sig"), "2.5.47", "x64")
            self.assertEqual(selected["UPDATER"], updater)

    def test_refuses_wrong_tag_missing_signature_and_arm_for_intel(self):
        for metadata in [
            {"tag_name": "v2.5.46", "assets": []},
            self.metadata("Clash.Verge_2.5.47_x64.dmg", "Clash.Verge_2.5.47_x64.app.tar.gz"),
            self.metadata("Clash.Verge_2.5.47_x64.dmg", "Clash.Verge_aarch64.app.tar.gz", "Clash.Verge_aarch64.app.tar.gz.sig"),
        ]:
            with self.assertRaises(ValueError):
                assets.select(metadata, "2.5.47", "x64")

    def test_stages_native_branded_files_without_changing_any_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            inputs = {"dmg/神仙云_2.5.47_x64.dmg": b"dmg-original", "macos/神仙云.app.tar.gz": b"tar-original", "macos/神仙云.app.tar.gz.sig": b"signature-original"}
            for name, data in inputs.items():
                p = root / name
                p.parent.mkdir(exist_ok=True)
                p.write_bytes(data)
            result = assets.stage(root, root / "out", "2.5.47", "x64")
            self.assertEqual([Path(p).read_bytes() for p in result.values()], list(inputs.values()))
            self.assertEqual(result, assets.stage(root, root / "out", "2.5.47", "x64"))
            Path(result["SIG"]).write_bytes(b"unrelated-signature")
            with self.assertRaises(ValueError):
                assets.stage(root, root / "out", "2.5.47", "x64")

    def test_release_workflow_preserves_ascii_mac_download_names(self):
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/release.yml").read_text()
        self.assertIn("contains(matrix.target, 'apple-darwin') && 'Clash.Verge_[version]_[arch][ext]'", workflow)
        intel = (root / ".github/workflows/macos-intel.yml").read_text()
        self.assertIn("macos-release-assets.py stage", intel)
        self.assertIn("macos-release-assets.py select", intel)


if __name__ == "__main__":
    unittest.main()

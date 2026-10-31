#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock


SCRIPT_PATH = Path(__file__).with_name("nas-sync-release-to-dufs.py")
SPEC = importlib.util.spec_from_file_location("nas_sync_release_to_dufs", SCRIPT_PATH)
assert SPEC is not None and SPEC.loader is not None
SYNC = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = SYNC
SPEC.loader.exec_module(SYNC)


def fake_asset(name: str) -> dict[str, object]:
    return {
        "name": name,
        "size": 100,
        "digest": "sha256:" + "a" * 64,
        "browser_download_url": (
            f"https://github.com/abxian/shenxianyun/releases/download/v1.2.3/{name}"
        ),
    }


class BuildPlanTests(unittest.TestCase):
    def test_tag_is_optional_for_latest_stable_release(self) -> None:
        previous = sys.argv
        try:
            sys.argv = [str(SCRIPT_PATH)]
            self.assertIsNone(SYNC.parse_args().tag)
        finally:
            sys.argv = previous

    def setUp(self) -> None:
        names = [
            "Clash.Verge_1.2.3_x64-setup.exe",
            "Clash.Verge_1.2.3_x64-setup.exe.sig",
            "Clash.Verge_1.2.3_arm64-setup.exe",
            "Clash.Verge_1.2.3_aarch64.dmg",
            "Clash.Verge_1.2.3_x64.dmg",
            "Clash.Verge_1.2.3_amd64.deb",
            "Clash.Verge-1.2.3-1.x86_64.rpm",
            "Clash.Verge_aarch64.app.tar.gz",
            "Clash.Verge_aarch64.app.tar.gz.sig",
            "Clash.Verge.app.tar.gz",
            "Clash.Verge.app.tar.gz.sig",
        ]
        self.assets = {name: fake_asset(name) for name in names}
        base = "https://github.com/abxian/shenxianyun/releases/download/v1.2.3"
        self.update_data = {
            "version": "1.2.3",
            "platforms": {
                "win64": {
                    "url": f"{base}/Clash.Verge_1.2.3_x64-setup.exe",
                    "signature": "win-signature",
                },
                "windows-x86_64": {
                    "url": f"{base}/Clash.Verge_1.2.3_x64-setup.exe",
                    "signature": "win-signature",
                },
                "darwin-aarch64": {
                    "url": f"{base}/Clash.Verge_aarch64.app.tar.gz",
                    "signature": "arm-signature",
                },
                "darwin": {
                    "url": f"{base}/Clash.Verge.app.tar.gz",
                    "signature": "intel-signature",
                },
                "darwin-intel": {
                    "url": f"{base}/Clash.Verge.app.tar.gz",
                    "signature": "intel-signature",
                },
                "darwin-x86_64": {
                    "url": f"{base}/Clash.Verge.app.tar.gz",
                    "signature": "intel-signature",
                },
            },
        }

    def test_build_plan_versions_updater_files_and_includes_aliases(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            publish, rewritten, needed = SYNC.build_plan(
                tag="v1.2.3",
                release_assets=self.assets,
                update_data=self.update_data,
                public_base="https://downloads.example/sxy/",
                staging=Path(temporary),
            )

        targets = {str(item.relative_target) for item in publish}
        self.assertIn("神仙云.exe", targets)
        self.assertIn("神仙云-arm64.exe", targets)
        self.assertIn("神仙云.dmg", targets)
        self.assertIn("神仙云-Intel.dmg", targets)
        self.assertIn("神仙云.deb", targets)
        self.assertIn("神仙云.rpm", targets)
        self.assertIn(
            "updater/v1.2.3-Clash.Verge.app.tar.gz",
            targets,
        )
        self.assertIn("Clash.Verge.app.tar.gz.sig", needed)
        self.assertEqual(
            rewritten["platforms"]["darwin-intel"]["url"],
            "https://downloads.example/sxy/updater/"
            "v1.2.3-Clash.Verge.app.tar.gz",
        )

    def test_versioned_mac_updaters_keep_existing_installer_aliases(self) -> None:
        assets = dict(self.assets)
        replacements = {
            "Clash.Verge_aarch64.app.tar.gz": "Clash.Verge_1.2.3_aarch64.app.tar.gz",
            "Clash.Verge.app.tar.gz": "Clash.Verge_1.2.3_x64.app.tar.gz",
        }
        for old, new in replacements.items():
            for suffix in ["", ".sig"]:
                assets.pop(old + suffix)
                assets[new + suffix] = fake_asset(new + suffix)
        data = json.loads(json.dumps(self.update_data))
        for value in data["platforms"].values():
            for old, new in replacements.items():
                value["url"] = value["url"].replace(old, new)
        with tempfile.TemporaryDirectory() as temporary:
            publish, rewritten, needed = SYNC.build_plan(
                tag="v1.2.3", release_assets=assets, update_data=data,
                public_base="https://downloads.example/sxy/", staging=Path(temporary),
            )
        mapping = {str(item.relative_target): item.source_asset for item in publish}
        self.assertEqual(mapping["神仙云.dmg"], "Clash.Verge_1.2.3_aarch64.dmg")
        self.assertEqual(mapping["神仙云-Intel.dmg"], "Clash.Verge_1.2.3_x64.dmg")
        self.assertIn("Clash.Verge_1.2.3_x64.app.tar.gz.sig", needed)
        self.assertTrue(rewritten["platforms"]["darwin-intel"]["url"].endswith("v1.2.3-Clash.Verge_1.2.3_x64.app.tar.gz"))

    def test_build_plan_ignores_stale_assets_from_an_older_version(self) -> None:
        stale_names = [
            "Clash.Verge_1.2.2_x64-setup.exe",
            "Clash.Verge_1.2.2_arm64-setup.exe",
            "Clash.Verge_1.2.2_aarch64.dmg",
            "Clash.Verge_1.2.2_x64.dmg",
            "Clash.Verge_1.2.2_amd64.deb",
            "Clash.Verge-1.2.2-1.x86_64.rpm",
        ]
        assets = dict(self.assets)
        assets.update({name: fake_asset(name) for name in stale_names})

        with tempfile.TemporaryDirectory() as temporary:
            publish, _, _ = SYNC.build_plan(
                tag="v1.2.3",
                release_assets=assets,
                update_data=self.update_data,
                public_base="https://downloads.example/sxy",
                staging=Path(temporary),
            )

        aliases = {
            str(item.relative_target): item.source_asset
            for item in publish
            if not str(item.relative_target).startswith("updater/")
        }
        self.assertEqual(
            aliases["神仙云.exe"],
            "Clash.Verge_1.2.3_x64-setup.exe",
        )
        self.assertTrue(all("1.2.2" not in name for name in aliases.values()))

    def test_build_plan_rejects_missing_intel_platforms(self) -> None:
        update_data = json.loads(json.dumps(self.update_data))
        del update_data["platforms"]["darwin-intel"]
        with tempfile.TemporaryDirectory() as temporary:
            with self.assertRaisesRegex(SYNC.SyncError, "darwin-intel"):
                SYNC.build_plan(
                    tag="v1.2.3",
                    release_assets=self.assets,
                    update_data=update_data,
                    public_base="https://downloads.example/sxy",
                    staging=Path(temporary),
                )

    def test_download_mirror_is_tried_before_direct_github(self) -> None:
        asset = fake_asset("Clash.Verge.app.tar.gz")
        urls = SYNC.candidate_download_urls(asset, "https://mirror.example/")
        self.assertEqual(
            urls,
            [
                "https://mirror.example/"
                "https://github.com/abxian/shenxianyun/releases/download/"
                "v1.2.3/Clash.Verge.app.tar.gz",
                asset["browser_download_url"],
            ],
        )

    def test_asset_request_headers_resume_from_partial_size(self) -> None:
        self.assertNotIn("Range", SYNC.asset_request_headers(0))
        self.assertEqual(
            SYNC.asset_request_headers(12_345)["Range"],
            "bytes=12345-",
        )

    def test_fetch_json_retries_transient_network_failure(self) -> None:
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.read.return_value = b'{"tag_name":"v1.2.3"}'
        with mock.patch.object(
            SYNC,
            "open_url",
            side_effect=[urllib.error.URLError("temporary"), response],
        ), mock.patch.object(SYNC.time, "sleep"):
            result = SYNC.fetch_json(
                "https://api.github.example/latest",
                timeout=5,
                retries=2,
            )
        self.assertEqual(result["tag_name"], "v1.2.3")


class AtomicPublishTests(unittest.TestCase):
    def test_success_backs_up_previous_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dufs = root / "dufs"
            backups = root / "backups"
            staging = dufs / ".release-sync-staging" / "test"
            dufs.mkdir(parents=True)
            staging.mkdir(parents=True)
            (dufs / "神仙云.exe").write_bytes(b"old-installer")
            (dufs / "update.json").write_text(
                '{"version":"1.2.2"}',
                encoding="utf-8",
            )
            source = staging / "new-installer"
            source.write_bytes(b"new-installer")

            backup = SYNC.publish_atomically(
                dufs_root=dufs,
                backup_root=backups,
                tag="v1.2.3-success",
                staging=staging,
                publish_files=[
                    SYNC.PublishFile(source, Path("神仙云.exe"), "installer.exe"),
                ],
                update_data={"version": "1.2.3", "platforms": {}},
            )

            self.assertEqual((dufs / "神仙云.exe").read_bytes(), b"new-installer")
            self.assertEqual(
                json.loads((dufs / "update.json").read_text())["version"],
                "1.2.3",
            )
            self.assertEqual(
                (backup / "神仙云.exe").read_bytes(),
                b"old-installer",
            )

    def test_failure_rolls_back_files_and_update_json(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            dufs = root / "dufs"
            backups = root / "backups"
            staging = dufs / ".release-sync-staging" / "test"
            dufs.mkdir(parents=True)
            staging.mkdir(parents=True)
            (dufs / "first.bin").write_bytes(b"old-first")
            (dufs / "second.bin").write_bytes(b"old-second")
            (dufs / "update.json").write_text(
                '{"version":"1.2.2"}',
                encoding="utf-8",
            )
            first = staging / "first.bin"
            first.write_bytes(b"new-first")
            missing = staging / "missing.bin"

            with self.assertRaises(FileNotFoundError):
                SYNC.publish_atomically(
                    dufs_root=dufs,
                    backup_root=backups,
                    tag="v1.2.3-rollback",
                    staging=staging,
                    publish_files=[
                        SYNC.PublishFile(first, Path("first.bin"), "first.bin"),
                        SYNC.PublishFile(missing, Path("second.bin"), "second.bin"),
                    ],
                    update_data={"version": "1.2.3", "platforms": {}},
                )

            self.assertEqual((dufs / "first.bin").read_bytes(), b"old-first")
            self.assertEqual((dufs / "second.bin").read_bytes(), b"old-second")
            self.assertEqual(
                json.loads((dufs / "update.json").read_text())["version"],
                "1.2.2",
            )


if __name__ == "__main__":
    unittest.main()

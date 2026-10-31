#!/usr/bin/env python3
"""Test actual native notification dispatch with an isolated queued-runtime double.

Requires Python 3.11+, Cargo/rustc and this repo's Cargo.lock/cache. No GUI,
network, user configuration or VPN changes. Cargo target is temporary. The
runtime double models the inspected Tauri 2.11.2 scheduling/lock contract; this
is a regression test, not a real macOS WebKit acceptance test.
"""
import pathlib
import shutil
import subprocess
import tempfile
import tomllib

root = pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='sxy-notification-test-') as tmp:
    work = pathlib.Path(tmp)
    (work / 'Cargo.toml').write_text(
        '[workspace]\n[package]\nname="notification-dispatch-check"\nversion="0.0.0"\nedition="2024"\n'
        '[dependencies]\nserde={version="=1.0.228",features=["derive"]}\n'
        'serde_json="=1.0.150"\nsmartstring={version="=1.0.1",features=["serde"]}\n'
        '[lib]\npath="lib.rs"\n')
    shutil.copy2(root / 'Cargo.lock', work / 'Cargo.lock')
    fixture = (root / 'scripts/fixtures/notification-dispatch.rs').read_text()
    fixture = fixture.replace('../../src-tauri/src/core/notification.rs', str(root / 'src-tauri/src/core/notification.rs'))
    (work / 'lib.rs').write_text(fixture)
    subprocess.run(['cargo', 'test', '--offline', '--manifest-path', str(work / 'Cargo.toml')], check=True, timeout=120)
    locked = {(p['name'], p['version'], p.get('checksum')) for p in tomllib.loads((root / 'Cargo.lock').read_text())['package']}
    for package in tomllib.loads((work / 'Cargo.lock').read_text())['package']:
        if package['name'] != 'notification-dispatch-check':
            assert (package['name'], package['version'], package.get('checksum')) in locked, package['name']
    print('PASS: actual notification module, owned payloads, FIFO, contended registry, missing window and closed loop; dependencies match Cargo.lock')

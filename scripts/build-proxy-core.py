#!/usr/bin/env python3
"""Build every desktop accounting sidecar from pinned upstream + audited patch.
Python3/git/Go; fail closed, never silently reuse a stock core. TARGET matches
prebuild's desktop Rust triples. --describe prints the target plan without IO;
--test-only runs actual native Go accounting tests without a target build.
Public source/dependency downloads only; writes node_modules/.verge/proxy-core,
src-tauri/sidecar stable+alpha and exact target/patch/binary SHA manifest. No
installation or network settings. Remove build outputs to rebuild. A new pin
requires patch/test/live traffic QA. Source/date: Codex277/2026-10-30.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SHA = '3f27ef39f8c96bbfbc8b0b9bb10f5c9ef60149d8'
TARGETS = {
    'x86_64-pc-windows-msvc': ('windows', 'amd64'),
    'i686-pc-windows-msvc': ('windows', '386'),
    'aarch64-pc-windows-msvc': ('windows', 'arm64'),
    'x86_64-apple-darwin': ('darwin', 'amd64'),
    'aarch64-apple-darwin': ('darwin', 'arm64'),
    'x86_64-unknown-linux-gnu': ('linux', 'amd64'),
    'i686-unknown-linux-gnu': ('linux', '386'),
    'aarch64-unknown-linux-gnu': ('linux', 'arm64'),
    'armv7-unknown-linux-gnueabihf': ('linux', 'arm'),
    'riscv64gc-unknown-linux-gnu': ('linux', 'riscv64'),
    'loongarch64-unknown-linux-gnu': ('linux', 'loong64'),
}


def describe(target):
    goos, arch = TARGETS[target]
    return {'target': target, 'goos': goos, 'goarch': arch,
            'goarm': '7' if arch == 'arm' else None,
            'extension': '.exe' if goos == 'windows' else '',
            'core_names': ['verge-mihomo', 'verge-mihomo-alpha']}


def verify_binary(data, plan):
    arch, goos = plan['goarch'], plan['goos']
    if goos == 'windows':
        assert data[:2] == b'MZ'
        offset = struct.unpack_from('<I', data, 0x3c)[0]
        assert data[offset:offset + 4] == b'PE\0\0'
        assert struct.unpack_from('<H', data, offset + 4)[0] == {'amd64': 0x8664, 'arm64': 0xaa64, '386': 0x14c}[arch]
    elif goos == 'darwin':
        assert data[:4] == b'\xcf\xfa\xed\xfe'
        assert struct.unpack_from('<I', data, 4)[0] == {'amd64': 0x1000007, 'arm64': 0x100000c}[arch]
    else:
        assert data[:4] == b'\x7fELF' and data[5] == 1
        assert data[4] == (1 if arch in ['386', 'arm'] else 2)
        assert struct.unpack_from('<H', data, 18)[0] == {'amd64': 62, '386': 3, 'arm': 40, 'arm64': 183, 'riscv64': 243, 'loong64': 258}[arch]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=TARGETS)
    parser.add_argument('--describe', action='store_true')
    parser.add_argument('--test-only', action='store_true')
    args = parser.parse_args()
    plan = describe(args.target)
    if args.describe:
        print(json.dumps(plan))
        return
    patch = ROOT / 'scripts/mihomo/proxy-traffic.patch'
    digest = hashlib.sha256(patch.read_bytes()).hexdigest()
    work = ROOT / 'node_modules/.verge/proxy-core' / digest[:16]
    work.mkdir(parents=True, exist_ok=True)
    def run(command, **kw):
        return subprocess.check_call(command, cwd=work, **kw)
    if not (work / '.git').exists():
        run(['git', 'init'])
        run(['git', 'remote', 'add', 'origin', 'https://github.com/MetaCubeX/mihomo.git'])
        run(['git', 'fetch', '--depth', '1', 'origin', SHA])
        run(['git', 'checkout', '--detach', 'FETCH_HEAD'])
        assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=work, text=True).strip() == SHA
        run(['git', 'apply', '--check', str(patch)])
        run(['git', 'apply', str(patch)])
    assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=work, text=True).strip() == SHA
    run(['git', 'apply', '--reverse', '--check', str(patch)])
    # Run tests on the builder's host even when the requested sidecar is cross-compiled.
    native = os.environ.copy()
    for key in ['GOOS', 'GOARCH', 'GOARM']:
        native.pop(key, None)
    run(['go', 'test', '-tags', 'with_gvisor', './tunnel/statistic', './tunnel', '-run', 'TestProxyAccounting', '-count=1'], env=native)
    if args.test_only:
        return
    env = native.copy()
    env.update(GOOS=plan['goos'], GOARCH=plan['goarch'], CGO_ENABLED='0')
    if plan['goarm']:
        env['GOARM'] = plan['goarm']
    out = work / ('proxy-' + plan['goos'] + '-' + plan['goarch'] + plan['extension'])
    run(['go', 'build', '-trimpath', '-tags', 'with_gvisor', '-ldflags',
         '-s -w -X github.com/metacubex/mihomo/constant.Version=sxy-proxy277-' + SHA[:8], '-o', str(out), '.'], env=env)
    data = out.read_bytes()
    verify_binary(data, plan)
    binary_sha = hashlib.sha256(data).hexdigest()
    sidecar = ROOT / 'src-tauri/sidecar'
    sidecar.mkdir(exist_ok=True)
    for name in plan['core_names']:
        target = sidecar / (name + '-' + args.target + plan['extension'])
        shutil.copyfile(out, target)
        if plan['goos'] != 'windows':
            target.chmod(0o755)
        assert hashlib.sha256(target.read_bytes()).hexdigest() == binary_sha
    (sidecar / ('proxy-accounting-' + args.target + '.json')).write_text(json.dumps({
        **{k: v for k, v in plan.items() if k != 'core_names'},
        'stable_and_alpha_identical': True,
        'upstream': SHA, 'patch_sha256': digest, 'binary_sha256': binary_sha,
        'binary_format_and_architecture_verified': True,
    }, indent=2) + "\n")
    print('Accounting sidecars verified:', args.target, binary_sha)


if __name__ == '__main__':
    main()

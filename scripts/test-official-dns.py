"""Test the exact shared DNS/selector modules without building the GUI.

Python3 + Rust/Cargo and cached locked crates. CI can fetch missing locked crates
with --fetch-dependencies before the offline checks. Temporary synthetic config only;
no app, VPN, system proxy, subscriptions or public network requests. Optional
--fixture-program copies the production enhancer harness for live core checks.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture-program', type=Path)
    parser.add_argument('--fetch-dependencies', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='sxnn-dns279-') as temporary:
        work = Path(temporary)
        shutil.copy2(root / 'Cargo.lock', work / 'Cargo.lock')
        (work / 'Cargo.toml').write_text(
            '[package]\nname="official-dns-check"\nversion="0.0.0"\nedition="2024"\n'
            '[workspace]\n[dependencies]\nserde_yaml_ng="=0.10.0"\n'
            '[lib]\npath="lib.rs"\n[[bin]]\nname="fixture"\npath="fixture.rs"\n')
        modules = ''.join(
            '#[path = ' + json.dumps(str(root / 'src-tauri/src/enhance' / (name + '.rs')))
            + '] pub mod ' + name + ';\n'
            for name in ['automatic', 'official_dns'])
        (work / 'lib.rs').write_text(modules)
        (work / 'fixture.rs').write_text(
            modules + 'use std::io::Read;\nfn main() {'
            'let mut input=String::new();std::io::stdin().read_to_string(&mut input).unwrap();'
            'let mut config: serde_yaml_ng::Mapping=serde_yaml_ng::from_str(&input).unwrap();'
            'automatic::ensure_automatic_selection(&mut config);'
            'official_dns::apply(&mut config).unwrap();'
            'print!("{}",serde_yaml_ng::to_string(&config).unwrap());}')
        env = dict(os.environ, CARGO_TARGET_DIR=str(root / 'node_modules/.cache/official-dns-check'))
        if args.fetch_dependencies:
            subprocess.run(['cargo', 'fetch', '--manifest-path', str(work / 'Cargo.toml')],
                           env=env, check=True)
        subprocess.run(['cargo', 'test', '--offline', '--manifest-path', str(work / 'Cargo.toml'), '--lib'],
                       env=env, check=True)
        subprocess.run(['cargo', 'clippy', '--offline', '--manifest-path', str(work / 'Cargo.toml'),
                        '--all-targets', '--', '-D', 'warnings'], env=env, check=True)
        if args.fixture_program:
            subprocess.run(['cargo', 'build', '--offline', '--manifest-path', str(work / 'Cargo.toml'), '--bin', 'fixture'],
                           env=env, check=True)
            shutil.copy2(Path(env['CARGO_TARGET_DIR']) / 'debug/fixture', args.fixture_program)


if __name__ == '__main__':
    main()

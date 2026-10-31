#!/usr/bin/env python3
"""Compile pure runtime-policy tests and exercise isolated Mihomo failover.

Requires Cargo/rustc, cached locked dependencies, Python3 and the current core binary.
Only temporary files, localhost ports and fake nodes are used. Never installs,
changes system proxy/TUN, reads subscriptions, or contacts public test URLs.
"""
import argparse
import json
import socket
import shutil
import socketserver
import subprocess
import tempfile
import threading
import time
import tomllib
import urllib.parse
import urllib.request
from pathlib import Path


def run(*args, **kwargs):
    process = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    if process.returncode:
        # Local Cargo/core diagnostics only; these commands carry no credentials.
        raise RuntimeError(process.stderr.decode(errors='replace')[-12000:])
    return process.stdout


class FakeSocks(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        sock = self.request
        sock.settimeout(3)

        def read(n):
            data = b''
            while len(data) < n:
                part = sock.recv(n - len(data))
                if not part:
                    raise ConnectionError('fake peer closed')
                data += part
            return data

        try:
            greeting = read(2)
            read(greeting[1])
            sock.sendall(b'\x05\x00')
            header = read(4)
            if header[3] == 1:
                read(4)
            elif header[3] == 3:
                read(read(1)[0])
            elif header[3] == 4:
                read(16)
            read(2)
            if not self.server.healthy:
                sock.sendall(b'\x05\x05\x00\x01\x7f\x00\x00\x01\x00\x00')
                return
            sock.sendall(b'\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x00')
            request = b''
            while b'\r\n\r\n' not in request and len(request) < 8192:
                request += read(1)
            sock.sendall(b'HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n')
        except (OSError, ConnectionError):
            return


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--deps', type=Path, help='Legacy argument; no release rlib is linked')
    parser.add_argument('--core', required=True, type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    source = root / 'src-tauri/src/enhance/automatic.rs'
    with tempfile.TemporaryDirectory(prefix='shenxian-auto-policy-') as temporary:
        work = Path(temporary)
        # Release dependencies may use LTO/profile-specific compiler options.
        # A standalone Cargo harness compiles the exact production source using
        # the repository lockfile and cached crates, rather than linking an
        # arbitrary release rlib with incompatible test/compiler settings.
        harness = work / 'harness'
        harness.mkdir()
        shutil.copy2(root / 'Cargo.lock', harness / 'Cargo.lock')
        (harness / 'Cargo.toml').write_text(
            '[package]\nname = "automatic-policy-check"\nversion = "0.0.0"\nedition = "2024"\n'
            '[workspace]\n[dependencies]\nserde_yaml_ng = "=0.10.0"\n'
            '[lib]\npath = "lib.rs"\n[[bin]]\nname = "fixture"\npath = "fixture.rs"\n')
        (harness / 'lib.rs').write_text('#[path = ' + json.dumps(str(source)) + '] mod automatic;')
        (harness / 'fixture.rs').write_text('#[path = ' + json.dumps(str(source)) + '] mod automatic;\n'
            'fn main() { let mut config: serde_yaml_ng::Mapping = serde_yaml_ng::from_str(&std::fs::read_to_string(std::env::args().nth(1).unwrap()).unwrap()).unwrap();'
            'automatic::ensure_automatic_selection(&mut config); println!("{}",serde_yaml_ng::to_string(&config).unwrap()); }')
        print(run('cargo', 'test', '--offline', '--manifest-path', str(harness / 'Cargo.toml'), '--lib').decode(), end='')
        run('cargo', 'build', '--offline', '--manifest-path', str(harness / 'Cargo.toml'), '--bin', 'fixture')
        locked = {
            (p['name'], p['version'], p.get('checksum'))
            for p in tomllib.loads((root / 'Cargo.lock').read_text())['package']
        }
        for package in tomllib.loads((harness / 'Cargo.lock').read_text())['package']:
            if package.get('source'):
                assert (package['name'], package['version'], package.get('checksum')) in locked
        fixture_program = harness / 'target/debug/fixture'
        servers = [FakeSocks(('127.0.0.1', 0), Handler) for _ in range(2)]
        core = None
        try:
            for index, server in enumerate(servers):
                server.healthy = index == 0
                threading.Thread(target=server.serve_forever, daemon=True).start()
            with socket.socket() as port:
                port.bind(('127.0.0.1', 0))
                controller = port.getsockname()[1]
            fixture = {
                'mixed-port': 0, 'allow-lan': False, 'mode': 'rule', 'log-level': 'silent',
                'external-controller': f'127.0.0.1:{controller}',
                'tun': {'enable': False}, 'dns': {'enable': False},
                'proxies': [{'name': name, 'type': 'socks5', 'server': '127.0.0.1',
                             'port': server.server_address[1]} for name, server in zip(['A', 'B'], servers)],
                'proxy-groups': [{'name': '节点选择', 'type': 'select', 'proxies': ['自动选择', 'A', 'B']},
                                 {'name': '自动选择', 'type': 'url-test', 'proxies': ['A', 'B']}],
                'rules': ['MATCH,节点选择'],
            }
            raw = work / 'input.json'
            raw.write_text(json.dumps(fixture, ensure_ascii=False))
            generated = run(str(fixture_program), str(raw)).decode()
            # Validate the EXACT production policy before replacing only the
            # probe URL/interval/timeout for the offline failure simulation.
            config = work / 'config.yaml'
            config.write_text(generated)
            run(str(args.core.resolve()), '-t', '-d', str(work), '-f', str(config))
            generated = generated.replace('https://www.gstatic.com/generate_204', 'http://probe.invalid/generate_204')
            generated = generated.replace('interval: 60', 'interval: 1').replace('timeout: 5000', 'timeout: 500')
            config.write_text(generated)
            core = subprocess.Popen([str(args.core.resolve()), '-d', str(work), '-f', str(config)],
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            base = f'http://127.0.0.1:{controller}'

            def get(path):
                with urllib.request.urlopen(base + path, timeout=4) as response:
                    return json.load(response)

            group = urllib.parse.quote('自动选择')
            for _ in range(50):
                try:
                    get('/version')
                    break
                except OSError:
                    time.sleep(0.1)
            query = urllib.parse.urlencode({'url': 'http://probe.invalid/generate_204', 'timeout': 500})

            def wait_for(name):
                for _ in range(30):
                    get(f'/group/{group}/delay?{query}')
                    state = get('/proxies/' + group)
                    if state.get('now') == name:
                        return
                    time.sleep(0.2)
                raise AssertionError('automatic policy failed to select ' + name)

            wait_for('A')
            servers[0].healthy = False
            servers[1].healthy = True
            wait_for('B')
            print('PASS: exact production configuration validates; isolated core switches A -> B when A fails')
            print('LIMIT: localhost simulation; real subscription/VPN acceptance remains pending')
        finally:
            if core is not None:
                core.terminate()
                try:
                    core.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    core.kill()
                    core.wait()
            for server in servers:
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    main()

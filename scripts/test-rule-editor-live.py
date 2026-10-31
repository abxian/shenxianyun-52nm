"""Real Mihomo /rules plus HTTP matching from exact production enhancer fixtures.
Usage python test-rule-editor-live.py CORE EDITED_YAML DELETED_YAML.
Only ephemeral loopback listeners/processes; no system proxy, TUN or user data.
"""
import http.server
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request


def freeport():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class Origin(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b'rule-editor-direct-ok'
        self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


origin = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Origin)
threading.Thread(target=origin.serve_forever, daemon=True).start()
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
try:
    for fixture, edited in [(sys.argv[2], True), (sys.argv[3], False)]:
        with tempfile.TemporaryDirectory(prefix='sxnn-rule-live-') as tmp:
            work = Path(tmp)
            mixed, api = freeport(), freeport()
            config = Path(fixture).read_text().replace('mixed-port: 0', 'mixed-port: ' + str(mixed))
            config += '\nbind-address: 127.0.0.1\nexternal-controller: 127.0.0.1:' + str(api) + '\nhosts:\n  example.com: 127.0.0.1\n  52nm.de: 127.0.0.1\n  sxy.52nm.de: 127.0.0.1\n'
            (work / 'config.yaml').write_text(config)
            subprocess.run([sys.argv[1], '-t', '-d', tmp], check=True, stdout=subprocess.DEVNULL)
            with (work / 'core.log').open('wb') as log:
                core = subprocess.Popen([sys.argv[1], '-d', tmp], stdout=log, stderr=log)
                try:
                    for _ in range(100):
                        try:
                            rules = json.loads(opener.open('http://127.0.0.1:' + str(api) + '/rules', timeout=1).read())['rules']
                            if rules:
                                break
                        except OSError:
                            pass
                        time.sleep(.1)
                    else:
                        raise AssertionError('rules API not ready')
                    assert rules[0]['payload'] == 'api.52nm.de' and rules[0]['proxy'] == 'DIRECT', rules
                    by_payload = {rule['payload']: rule for rule in rules if rule['type'] != 'DomainSuffix'}
                    assert by_payload['52nm.de']['proxy'] == 'REJECT', rules
                    assert by_payload['www.52nm.de']['proxy'] == 'REJECT', rules
                    assert by_payload['sxy.52nm.de']['proxy'] == 'DIRECT', rules
                    official_end = rules.index(by_payload['sxy.52nm.de'])
                    ordinary_index = next(i for i, rule in enumerate(rules) if rule['payload'] == 'acl4.ssr')
                    if edited:
                        assert rules[official_end + 1]['payload'] == 'example.com' and rules[official_end + 1]['proxy'] == 'DIRECT', rules
                        assert rules[ordinary_index - 1]['payload'] == 'legacy.example', rules
                    else:
                        assert ordinary_index == official_end + 1, rules
                    for rule in rules[1:official_end + 1]:
                        assert rule['payload'] in ['5443', '52nm.de', 'www.52nm.de', 'sxy.52nm.de'], rules
                    for _ in range(100):
                        try:
                            with socket.create_connection(('127.0.0.1', mixed), timeout=1):
                                break
                        except OSError:
                            time.sleep(.1)
                    else:
                        raise AssertionError('proxy listener not ready')
                    for attempt in range(50):
                        try:
                            with socket.create_connection(('127.0.0.1', mixed), timeout=2) as sock:
                                sock.settimeout(2)
                                host = 'example.com:' + str(origin.server_address[1])
                                sock.sendall(('GET http://' + host + '/ HTTP/1.1\r\nHost: ' + host + '\r\nConnection: close\r\n\r\n').encode())
                                data = b''
                                while chunk := sock.recv(4096):
                                    data += chunk
                            assert (b'rule-editor-direct-ok' in data) == edited, repr(data)
                            break
                        except OSError as error:
                            if not edited and isinstance(error, ConnectionResetError):
                                break  # REJECT closes or resets the client connection.
                            if attempt == 49:
                                raise
                            time.sleep(.1)
                    print(json.dumps({'edited': edited, 'api_direct_first': True, 'rules': rules, 'http_matching_verified': True}))
                finally:
                    core.terminate()
                    core.wait(timeout=10)
finally:
    origin.shutdown()

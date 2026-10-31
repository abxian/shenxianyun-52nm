"""277 executable target planning and wrong-format rejection tests.
Python3 only, no network/Go/product configuration or install writes.
"""
import importlib.util
from pathlib import Path
import struct
import unittest
root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('accounting_build', root/'scripts/build-proxy-core.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

class Targets(unittest.TestCase):
    def test_formal_targets_and_extensions(self):
        expected = {
            'x86_64-pc-windows-msvc': ('windows', 'amd64', '.exe', None),
            'aarch64-pc-windows-msvc': ('windows', 'arm64', '.exe', None),
            'aarch64-apple-darwin': ('darwin', 'arm64', '', None),
            'x86_64-apple-darwin': ('darwin', 'amd64', '', None),
            'x86_64-unknown-linux-gnu': ('linux', 'amd64', '', None),
            'aarch64-unknown-linux-gnu': ('linux', 'arm64', '', None),
            'armv7-unknown-linux-gnueabihf': ('linux', 'arm', '', '7'),
        }
        for target, values in expected.items():
            p = build.describe(target)
            self.assertEqual(tuple(p[k] for k in ['goos','goarch','extension','goarm']), values)
            self.assertEqual(p['core_names'], ['verge-mihomo','verge-mihomo-alpha'])
        with self.assertRaises(KeyError): build.describe('unexpected-target')

    def test_macho_rejects_other_architecture_and_platform(self):
        data=bytearray(32);data[:4]=b'\xcf\xfa\xed\xfe';struct.pack_into('<I',data,4,0x100000c)
        build.verify_binary(data, build.describe('aarch64-apple-darwin'))
        for target in ['x86_64-apple-darwin','aarch64-pc-windows-msvc','aarch64-unknown-linux-gnu']:
            with self.assertRaises(AssertionError):build.verify_binary(data,build.describe(target))

    def test_elf_rejects_other_architecture_and_word_size(self):
        data=bytearray(64);data[:4]=b'\x7fELF';data[4]=2;data[5]=1;struct.pack_into('<H',data,18,183)
        build.verify_binary(data, build.describe('aarch64-unknown-linux-gnu'))
        with self.assertRaises(AssertionError):build.verify_binary(data,build.describe('x86_64-unknown-linux-gnu'))
        data[4]=1
        with self.assertRaises(AssertionError):build.verify_binary(data,build.describe('aarch64-unknown-linux-gnu'))

    def test_pe_rejects_other_architecture(self):
        data=bytearray(256);data[:2]=b'MZ';struct.pack_into('<I',data,0x3c,0x80);data[0x80:0x84]=b'PE\0\0';struct.pack_into('<H',data,0x84,0x8664)
        build.verify_binary(data,build.describe('x86_64-pc-windows-msvc'))
        with self.assertRaises(AssertionError):build.verify_binary(data,build.describe('aarch64-pc-windows-msvc'))

if __name__ == '__main__':unittest.main()

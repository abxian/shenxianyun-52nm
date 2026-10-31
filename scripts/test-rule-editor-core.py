"""Compile actual production rule enhancement module in an isolated tiny crate.
Python3 + Rust stable; only serde_yaml_ng dependency, no GUI/sidecar build needed.
Temporary crate is removed on exit; CARGO_TARGET_DIR may cache compilation.
An optional output argument writes a final YAML fixture for real-core API checks.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
module = root / 'src-tauri/src/enhance/editor_rules.rs'
with tempfile.TemporaryDirectory(prefix='sxnn-rules272-') as tmp:
    work = Path(tmp)
    (work / 'src').mkdir()
    (work / 'Cargo.toml').write_text('[package]\nname="rule-editor-check"\nversion="0.1.0"\nedition="2024"\n[dependencies]\nserde_yaml_ng="0.10.0"\n')
    (work / 'src/lib.rs').write_text('#[path = ' + json.dumps(str(module)) + ']\npub mod editor_rules;\n')
    env = dict(os.environ, CARGO_TARGET_DIR=str(root / 'node_modules/.cache/rule-editor-check'))
    subprocess.run(['cargo', 'test', '--manifest-path', str(work / 'Cargo.toml')], env=env, check=True)
    if len(sys.argv) > 1:
        # Exact production function output, not a handwritten expected config.
        (work / 'src/main.rs').write_text('''use rule_editor_check::editor_rules;
fn main() {
 let mut config = serde_yaml_ng::from_str("mixed-port: 0\\nmode: rule\\nproxies: []\\nproxy-groups: []\\nrules: ['DST-PORT,5443,DIRECT', 'DOMAIN,52nm.de,REJECT', 'DOMAIN,www.52nm.de,REJECT', 'DOMAIN,api.52nm.de,DIRECT', 'DOMAIN,sxy.52nm.de,DIRECT', 'DOMAIN-SUFFIX,acl4.ssr,DIRECT', 'DOMAIN-SUFFIX,example.com,REJECT', 'MATCH,DIRECT']").unwrap();
 let edits = serde_yaml_ng::from_str("prepend-rules: ['DOMAIN-SUFFIX,example.com,DIRECT', 'DOMAIN-SUFFIX,52nm.de,DIRECT']\\nappend-rules: ['DOMAIN,legacy.example,REJECT']").unwrap();
 let deleted = std::env::args().any(|arg| arg == "--deleted");
 let edits = if deleted { serde_yaml_ng::Mapping::new() } else { edits };
 editor_rules::apply(&mut config, &edits).unwrap();
 print!("{}", serde_yaml_ng::to_string(&config).unwrap());
}
''')
        result = subprocess.run(['cargo', 'run', '--quiet', '--manifest-path', str(work / 'Cargo.toml')], env=env, check=True, capture_output=True)
        Path(sys.argv[1]).write_bytes(result.stdout)
        if len(sys.argv) > 2:
            result = subprocess.run(['cargo', 'run', '--quiet', '--manifest-path', str(work / 'Cargo.toml'), '--', '--deleted'], env=env, check=True, capture_output=True)
            Path(sys.argv[2]).write_bytes(result.stdout)

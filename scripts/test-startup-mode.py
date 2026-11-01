"""319 actual startup-default module tests, offline tiny crate and wiring gate.
Does not start the App/core or read real saved config. Only OnceCell initialization
may reset mode; backup loading and runtime core restart code keep their policies.
"""
from pathlib import Path
import tempfile,subprocess,json,os
root=Path(__file__).resolve().parents[1]
config=(root/'src-tauri/src/config/config.rs').read_text()
call='super::startup_mode::reset_for_app_start(&mut clash.0);'
start=config.index('.get_or_init(|| async {');end=config.index('    pub async fn clash()',start)
assert config.count(call)==1 and call in config[start:end]
assert config.index(call,start)<config.index('clash_config: Draft::new(clash)',start)
for path in (root/'src-tauri/src').rglob('*.rs'):
 if path != root/'src-tauri/src/config/config.rs':assert 'startup_mode::reset_for_app_start' not in path.read_text()
with tempfile.TemporaryDirectory(prefix='pc319-startup-mode-') as temporary:
 p=Path(temporary);(p/'src').mkdir()
 (p/'Cargo.toml').write_text('[package]\nname="startup-mode319-check"\nversion="0.1.0"\nedition="2024"\n[dependencies]\nserde_yaml_ng="0.10"\n')
 (p/'src/lib.rs').write_text('#[path='+json.dumps(str(root/'src-tauri/src/config/startup_mode.rs'))+'] mod startup_mode;')
 env=dict(os.environ,CARGO_TARGET_DIR=str(root/'node_modules/.cache/startup-mode319-check'))
 subprocess.run(['cargo','test']+([] if os.environ.get('CI') else ['--offline'])+['--manifest-path',str(p/'Cargo.toml')],env=env,check=True)
print('STARTUP_RULE_DEFAULT_AND_ONCECELL_ONLY_WIRING_VERIFIED',flush=True)

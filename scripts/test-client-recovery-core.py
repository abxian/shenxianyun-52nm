"""275 compile actual native download/cancel/owned-exit modules in a tiny crate.
Python3/Rust stable; no Tauri build, App, system proxy/TUN or production requests.
"""
from pathlib import Path
import tempfile,subprocess,json,os
root=Path(__file__).resolve().parents[1]
modules={'download_progress':'src-tauri/src/core/updater/download_progress.rs','download_control':'src-tauri/src/core/updater/download_control.rs','download_watchdog':'src-tauri/src/core/updater/download_watchdog.rs','sidecar_exit':'src-tauri/src/core/manager/sidecar_exit.rs'}
with tempfile.TemporaryDirectory(prefix='sxnn-client275-') as tmp:
 p=Path(tmp);(p/'src').mkdir();(p/'Cargo.toml').write_text('[package]\nname="client-recovery-check"\nversion="0.1.0"\nedition="2024"\n[dependencies]\ntokio={version="1",features=["full"]}\nparking_lot="0.12"\n')
 (p/'src/lib.rs').write_text('\n'.join('#[path='+json.dumps(str(root/path))+'] mod '+name+';' for name,path in modules.items()))
 env=dict(os.environ,CARGO_TARGET_DIR=str(root/'node_modules/.cache/client-recovery-check'))
 subprocess.run(['cargo','test','--manifest-path',str(p/'Cargo.toml')],env=env,check=True)

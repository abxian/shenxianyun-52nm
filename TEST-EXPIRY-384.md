# 到期显示修复测试版 · 2026-11-03

用户已在task383后明确授权发布测试包与测试版本，task384/评估558。原业务修复随父提交保留；本次只改测试流程，版本号/main/正式tag/正式下载入口/Web元数据保持不变。

测试入口固定在本仓库 Releases `test-expiry-20261103`，prerelease:true/make_latest:false/source精确绑定。此前alpha/autobuild预览不删除或覆盖。PC dev.yml显式publish_test=true才在全部选定平台成功后上传本run artifacts和SHA256SUMS/source.json；默认false，原development仅产物行为保留。测试覆盖Windows x64/ARM64、macOS Apple Silicon、Linux x64，未增加Intel macOS；macOS沿原无Developer ID签名方式。Android沿原AlphaRelease及原正式签名；缺任何签名secret直接失败，不降级debug。remove.suffix为true沿现有应用身份，测试包是同应用手动安装，非另外创建全新账户环境，版本号仍为原基线，不能靠正式自动更新下载。

提交dispatch后按用户约定不等待云结果；完成后核对准确source、安装包版本/签名/哈希/界面空期限与有限/过期/无提取码状态，不能把请求接收等同包已可用。回滚撤下唯一测试Release和test tag，或revert流程提交；已经下载的副本不能召回。正式包与原预览保持。

## Windows测试分支准入修正

首轮75c502f6的Windows x64在运行原自动检查前，被既有用例allowedBranches拒绝，分支codex/expiry-test-20261103尚未列入。仅在test-cases/windows-commercial.json明确追加此唯一分支，不扩大为任意分支、不改变requiredAncestor/检查项/人工验收要求；旧失败run41646734853保留，新提交重建独立测试版。

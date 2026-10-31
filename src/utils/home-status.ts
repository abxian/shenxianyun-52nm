// Hide routine progress/success chatter, but retain unknown native/network errors.
export const homeStatusMessage = (status: string): string => {
  if (!status) return ''
  if (
    /失败|错误|到期|过期|无法|不可用|异常|未完成|不支持|超时|请确认|请重新|请检查|请先|请稍后|本地编辑|停止远程覆盖/.test(
      status,
    )
  )
    return status
  if (
    /^(正在|客户端已启动|检测到后台推送|当前节点已是最新|启动订阅刷新完成|订阅已更新|订阅已导入|提取码已保存|提取码已续费|节点已切换|连通性测试完成|已|旧版订阅已|受管订阅已|系统代理已|TUN 已|DNS 覆写已|局域网连接已|系统服务已|订阅正在后台更新)/.test(
      status,
    )
  )
    return ''
  return status
}

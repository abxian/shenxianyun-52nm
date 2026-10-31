import type { ManagedAuth } from './managed-subscription'

// A user's explicit Update action may renew an expired subscription credential.
// Background polling must never silently re-register a revoked device.
export async function loadManagedContent(
  auth: ManagedAuth,
  userRequested: boolean,
  ports: {
    download: (auth: ManagedAuth) => Promise<string>
    status: (error: unknown) => number | undefined
    current: () => ManagedAuth | null
    renew: (auth: ManagedAuth) => Promise<ManagedAuth>
    persist: (auth: ManagedAuth) => Promise<void>
  },
): Promise<{ auth: ManagedAuth; content: string }> {
  try {
    return { auth, content: await ports.download(auth) }
  } catch (error) {
    if (
      !userRequested ||
      ![401, 403, 404, 410].includes(ports.status(error) ?? 0)
    ) {
      throw error
    }
    if (ports.current() !== auth)
      throw new Error('提取码已变化，已取消旧订阅更新', { cause: error })
    const next = await ports.renew(auth)
    if (ports.current() !== auth)
      throw new Error('提取码已变化，已取消旧订阅更新', { cause: error })
    // Exchange revokes the old token server-side. Retain the fresh credential even
    // if the new YAML is invalid; the existing usable config stays untouched.
    await ports.persist(next)
    if (ports.current() !== next)
      throw new Error('提取码已变化，已取消旧订阅更新', { cause: error })
    return { auth: next, content: await ports.download(next) }
  }
}

/** Valid managed subscriptions already authenticate and enforce access limits
 * at download time. A public status probe must not prevent that download when
 * its own network route fails. Recovery of missing/stale credentials still uses
 * the existing state/ticket/exchange checks in updateManagedProfile.
 */
export const refreshSubscriptionOnRequest = async <State>(ports: {
  managed: boolean
  readState: () => Promise<State>
  download: (state?: State) => Promise<void>
}): Promise<void> => {
  if (ports.managed) {
    await ports.download()
    return
  }
  await ports.download(await ports.readState())
}

export type TrafficTotals = { upload: number; download: number }

export type ManagedTrafficCounter = {
  version: 1
  accessCode: string
  counterId: string
  sequence: number
  base: TrafficTotals
  observed: TrafficTotals
}

export const createManagedTrafficCounter = (
  accessCode: string,
  totals: TrafficTotals,
  counterId: string = crypto.randomUUID?.() ||
    `traffic-${Date.now().toString(36)}`,
): ManagedTrafficCounter => ({
  version: 1,
  accessCode,
  counterId,
  sequence: 0,
  base: totals,
  observed: totals,
})

export const observeManagedTraffic = (
  counter: ManagedTrafficCounter,
  totals: TrafficTotals,
) => {
  if (
    totals.upload < counter.observed.upload ||
    totals.download < counter.observed.download
  ) {
    return { counter, reset: true }
  }
  return { counter: { ...counter, observed: totals }, reset: false }
}

export const managedTrafficPayload = (counter: ManagedTrafficCounter) => ({
  counter_id: counter.counterId,
  sequence: counter.sequence + 1,
  upload_total: Math.max(0, counter.observed.upload - counter.base.upload),
  download_total: Math.max(
    0,
    counter.observed.download - counter.base.download,
  ),
})

export const acknowledgeManagedTraffic = (
  counter: ManagedTrafficCounter,
  sequence: number,
): ManagedTrafficCounter => ({ ...counter, sequence })

export const parseManagedTrafficCounter = (
  raw: string | null,
  accessCode: string,
): ManagedTrafficCounter | null => {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<ManagedTrafficCounter>
    const validTotals = (totals?: Partial<TrafficTotals>) =>
      Number.isFinite(totals?.upload) &&
      Number.isFinite(totals?.download) &&
      Number(totals?.upload) >= 0 &&
      Number(totals?.download) >= 0
    if (
      value.version !== 1 ||
      value.accessCode !== accessCode ||
      !value.counterId ||
      !Number.isInteger(value.sequence) ||
      Number(value.sequence) < 0 ||
      !validTotals(value.base) ||
      !validTotals(value.observed)
    ) {
      return null
    }
    return value as ManagedTrafficCounter
  } catch {
    return null
  }
}

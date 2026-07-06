import { api } from './client'

export interface VersionInfo {
  version: string
  commit: string
  build_date: string
}

export async function getVersion(signal?: AbortSignal): Promise<VersionInfo> {
  const res = await api.get<VersionInfo>('/version', { signal })
  return res.data
}

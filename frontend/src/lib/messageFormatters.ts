import type { Address } from '../api/messages'

export function formatAddr(a: Address | undefined): string {
  if (!a) return ''
  return a.name ? `${a.name} <${a.address}>` : `<${a.address}>`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
}

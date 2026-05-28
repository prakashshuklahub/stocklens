import {
  cronWindowSkipMessage,
  getCronWindowStatus,
  logCronWindowSkip,
} from '@/lib/cron/window'

export function cronRouteGuard(routeName: string): Response | null {
  const status = getCronWindowStatus()
  if (status.allowed) return null

  logCronWindowSkip(routeName, status)
  return Response.json({
    skipped: true,
    reason: status.reason,
    message: cronWindowSkipMessage(status),
  })
}

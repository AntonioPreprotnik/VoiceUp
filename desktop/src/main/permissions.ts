import type { Session } from 'electron'

/**
 * Security rule 6: every permission is denied. S3.2 allows `media` for the recorder window only.
 */
export function denyAllPermissions(session: Session): void {
  session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.setPermissionCheckHandler(() => false)
}

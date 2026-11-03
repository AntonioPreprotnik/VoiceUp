import type { Session } from 'electron'

interface MediaDetails {
  readonly mediaTypes?: readonly string[]
}

/**
 * Security rule 6: every permission is denied, except the microphone for the recorder window, and
 * only for audio. `isRecorder` takes a webContents id.
 */
export function installPermissions(session: Session, isRecorder: (id: number) => boolean): void {
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const { mediaTypes = [] } = details as MediaDetails
    const audioOnly = mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio')
    callback(permission === 'media' && audioOnly && isRecorder(webContents.id))
  })
  session.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'media' && webContents !== null && isRecorder(webContents.id)
  })
}

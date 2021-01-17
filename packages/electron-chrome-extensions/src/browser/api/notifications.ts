import { app, Extension, Notification } from 'electron'
import { ExtensionEvent } from '../router'
import { ExtensionStore } from '../store'

enum TemplateType {
  Basic = 'basic',
  Image = 'image',
  List = 'list',
  Progress = 'progress',
}

const getUrgency = (
  priority?: number
): Required<Electron.NotificationConstructorOptions>['urgency'] => {
  if (typeof priority !== 'number') {
    return 'normal'
  } else if (priority >= 2) {
    return 'critical'
  } else if (priority < 0) {
    return 'low'
  } else {
    return 'normal'
  }
}

const createScopedIdentifier = (extension: Extension, id: string) => `${extension.id}-${id}`
const stripScopeFromIdentifier = (id: string) => {
  const index = id.indexOf('-')
  return id.substr(index + 1)
}

export class NotificationsAPI {
  private registry = new Map<string, Notification>()

  constructor(private store: ExtensionStore) {
    store.handle('notifications.clear', this.clear)
    store.handle('notifications.create', this.create)
    store.handle('notifications.getAll', this.getAll)
    store.handle('notifications.getPermissionLevel', this.getPermissionLevel)
    store.handle('notifications.update', this.update)

    this.store.session.on('extension-unloaded' as any, (event, extensionId) => {
      for (const [key, notification] of this.registry) {
        if (key.startsWith(extensionId)) {
          notification.close()
        }
      }
    })
  }

  private clear = ({ extension }: ExtensionEvent, id: string) => {
    const notificationId = createScopedIdentifier(extension, id)
    if (this.registry.has(notificationId)) {
      this.registry.get(notificationId)?.close()
      return true
    }
    return false
  }

  private create = ({ extension }: ExtensionEvent, arg1: unknown, arg2?: unknown) => {
    let id: string
    let opts: chrome.notifications.NotificationOptions

    if (typeof arg1 === 'object') {
      id = 'guid' // TODO: generate uuid
      opts = arg1 as chrome.notifications.NotificationOptions
    } else if (typeof arg1 === 'string') {
      id = arg1
      opts = arg2 as chrome.notifications.NotificationOptions
    } else {
      return
    }

    if (typeof opts !== 'object' || !opts.type || !opts.iconUrl || !opts.title || !opts.message) {
      return
    }

    const notificationId = createScopedIdentifier(extension, id)

    if (this.registry.has(notificationId)) {
      this.registry.get(notificationId)?.close()
    }

    const notification = new Notification({
      title: opts.title,
      subtitle: app.name,
      body: opts.message,
      silent: opts.silent,
      // icon: opts.iconUrl, // TODO: convert in renderer
      urgency: getUrgency(opts.priority),
      timeoutType: opts.requireInteraction ? 'never' : 'default',
    })

    this.registry.set(notificationId, notification)

    notification.on('click', () => {
      this.store.sendToExtensionHost(extension.id, 'notifications.onClicked', id)
    })

    notification.once('close', () => {
      const byUser = true // TODO
      this.store.sendToExtensionHost(extension.id, 'notifications.onClosed', id, byUser)
      this.registry.delete(notificationId)
    })

    notification.show()
  }

  private getAll = ({ extension }: ExtensionEvent) => {
    return Array.from(this.registry.keys())
      .filter((key) => key.startsWith(extension.id))
      .map(stripScopeFromIdentifier)
  }

  private getPermissionLevel = (event: ExtensionEvent) => {
    // Electron doesn't provide an API to determine this yet as far as I can
    // tell.
    return 'granted'
  }

  private update = (
    { extension }: ExtensionEvent,
    id: string,
    opts: chrome.notifications.NotificationOptions
  ) => {
    const notificationId = createScopedIdentifier(extension, id)

    const notification = this.registry.get(notificationId)

    if (!notification) {
      return false
    }

    // TODO: remaining opts

    if (opts.priority) notification.urgency = getUrgency(opts.priority)
    if (opts.silent) notification.silent = opts.silent
  }
}

import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'

/** The app page, as main loads it. */
export const APP_URL = 'kapecut://app/index.html'

/** Whether a URL is the app page, whatever its query or hash. */
export const isAppPage = (url: string) => url.split(/[?#]/)[0] === APP_URL

// Main keeps the window on the app page and opens no other (index.ts). Should a page still get past that, the preload
// runs in it with a bridge nobody has taken: main answers only the window's top frame on the app page itself (#126).
const fromApp = ({ senderFrame: f }: IpcMainEvent | IpcMainInvokeEvent) => !!f && !f.parent && isAppPage(f.url)

/** ipcMain.handle, for the app page only: any other sender is refused. Every invoke channel goes through it. */
export function handle<A extends unknown[]>(channel: string, fn: (e: IpcMainInvokeEvent, ...args: A) => unknown) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromApp(e)) throw new Error(`Refused ${channel}: not the app page`)
    return fn(e, ...(args as A))
  })
}

/** ipcMain.on for a sync message, for the app page only: any other sender gets null. */
export function on(channel: string, fn: (e: IpcMainEvent) => void) {
  ipcMain.on(channel, (e) => (fromApp(e) ? fn(e) : (e.returnValue = null)))
}

import { contextBridge, ipcRenderer } from 'electron';

const tokenArg = process.argv.find((arg) => arg.startsWith('--app-token='));
const appToken = tokenArg ? tokenArg.slice('--app-token='.length) : '';

contextBridge.exposeInMainWorld('electronAPI', {
  mouseMove: (x: number, y: number): void => {
    ipcRenderer.send('mouse:move', { x, y, token: appToken });
  },
  mouseClick: (button?: 'left' | 'right' | 'middle'): void => {
    ipcRenderer.send('mouse:click', { button, token: appToken });
  },
  mouseButton: (button: 'left' | 'right', action: 'down' | 'up'): void => {
    ipcRenderer.send('mouse:button', { button, action, token: appToken });
  },
  mouseScroll: (direction: 'up' | 'down'): void => {
    ipcRenderer.send('mouse:scroll', { direction, token: appToken });
  },
  zoom: (direction: 'in' | 'out'): void => {
    ipcRenderer.send('zoom', { direction, token: appToken });
  },
  getScreenSize: (): Promise<{ width: number; height: number }> => {
    return ipcRenderer.invoke('screen:size', { token: appToken }) as Promise<{ width: number; height: number }>;
  },
  setCompactMode: (compact: boolean): void => {
    ipcRenderer.send('window:set-compact', { compact, token: appToken });
  },
  onEmergencyStop: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('control:emergency-stop', handler);
    return () => {
      ipcRenderer.removeListener('control:emergency-stop', handler);
    };
  },
  onDragReleased: (callback: (data: { buttons: ('left' | 'right')[]; reason: string }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { buttons: ('left' | 'right')[]; reason: string }): void => {
      callback(data);
    };
    ipcRenderer.on('mouse:drag-released', handler);
    return () => {
      ipcRenderer.removeListener('mouse:drag-released', handler);
    };
  },
  isElectron: true,
});

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
  getScreenSize: (): Promise<{ x: number; y: number; width: number; height: number }> => {
    return ipcRenderer.invoke('screen:size', { token: appToken }) as Promise<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  },
  getAccessibilityStatus: (): Promise<{ trusted: boolean }> => {
    return ipcRenderer.invoke('system:accessibility-status', { token: appToken }) as Promise<{
      trusted: boolean;
    }>;
  },
  setCompactMode: (compact: boolean): void => {
    ipcRenderer.send('window:set-compact', { compact, token: appToken });
  },
  requestMediaAccess: (): Promise<{ success: boolean; camera: boolean; microphone: boolean }> => {
    return ipcRenderer.invoke('system:request-media-access', { token: appToken }) as Promise<{
      success: boolean;
      camera: boolean;
      microphone: boolean;
    }>;
  },
  getMediaStatus: (): Promise<{ camera: string; microphone: string }> => {
    return ipcRenderer.invoke('system:get-media-status', { token: appToken }) as Promise<{
      camera: string;
      microphone: string;
    }>;
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

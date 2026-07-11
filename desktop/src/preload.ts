import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  mouseMove: (x: number, y: number): void => {
    ipcRenderer.send('mouse:move', { x, y });
  },
  mouseClick: (button?: 'left' | 'right' | 'middle'): void => {
    ipcRenderer.send('mouse:click', { button });
  },
  mouseButton: (button: 'left' | 'right', action: 'down' | 'up'): void => {
    ipcRenderer.send('mouse:button', { button, action });
  },
  mouseScroll: (direction: 'up' | 'down'): void => {
    ipcRenderer.send('mouse:scroll', { direction });
  },
  zoom: (direction: 'in' | 'out'): void => {
    ipcRenderer.send('zoom', { direction });
  },
  getScreenSize: (): Promise<{ width: number; height: number }> => {
    return ipcRenderer.invoke('screen:size') as Promise<{ width: number; height: number }>;
  },
  setCompactMode: (compact: boolean): void => {
    ipcRenderer.send('window:set-compact', { compact });
  },
  isElectron: true,
});

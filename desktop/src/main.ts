import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import * as crypto from 'crypto';
import * as path from 'path';
import {
  DEADMAN_TIMEOUT_MS,
  DeadmanTimer,
  IpcRateLimiter,
  isAllowedLocalUrl,
  isAllowedNavigation,
  isMouseAction,
  isMouseButton,
  isMouseToggleButton,
  isScrollDirection,
  isTrustedSenderUrl,
  isValidAuthToken,
  isZoomDirection,
  parsePointPayload,
  type MouseToggleButton,
} from './security';

interface RobotModule {
  moveMouse(x: number, y: number): void;
  mouseClick(button?: 'left' | 'right' | 'middle', double?: boolean): void;
  mouseToggle(action: 'down' | 'up', button?: 'left' | 'right'): void;
  scrollMouse(x: number, y: number): void;
  keyToggle(key: string, action: 'down' | 'up'): void;
  getScreenSize(): { width: number; height: number };
}

let mainWindow: BrowserWindow | null = null;
let normalBounds: Electron.Rectangle | null = null;
let robotModule: RobotModule | null | undefined;
let trustedOrigin = '';
const sessionAuthToken = crypto.randomBytes(32).toString('hex');
const heldMouseButtons = new Set<MouseToggleButton>();

const ipcRateLimiter = new IpcRateLimiter();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function logDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  console.info(`[gesturebridge-desktop] ${event}`, details);
}

function isRobotModule(value: unknown): value is RobotModule {
  if (!isRecord(value)) return false;
  return (
    typeof value.moveMouse === 'function' &&
    typeof value.mouseClick === 'function' &&
    typeof value.mouseToggle === 'function' &&
    typeof value.scrollMouse === 'function' &&
    typeof value.keyToggle === 'function' &&
    typeof value.getScreenSize === 'function'
  );
}

function getRobot(): RobotModule | null {
  if (robotModule !== undefined) return robotModule;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded: unknown = require('robotjs');
    robotModule = isRobotModule(loaded) ? loaded : null;
    if (!robotModule) {
      console.error('robotjs loaded but did not expose the expected API.');
    }
  } catch (err) {
    robotModule = null;
    console.error('robotjs is unavailable. Run npm run rebuild in desktop/.', err);
  }

  return robotModule;
}

function getWebUrl(): string {
  const fallbackUrl = 'http://localhost:3000';
  const configuredUrl = process.env.WEB_URL ?? fallbackUrl;

  if (isAllowedLocalUrl(configuredUrl)) return configuredUrl;

  console.warn(`Blocked non-local WEB_URL "${configuredUrl}". Falling back to ${fallbackUrl}.`);
  return fallbackUrl;
}

function isTrustedIpcSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  payload: unknown
): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame?.parent) {
    return false;
  }

  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  if (!isTrustedSenderUrl(senderUrl, trustedOrigin)) {
    return false;
  }

  return isValidAuthToken(payload, sessionAuthToken);
}

function consumeIpcRateLimit(
  event: IpcMainEvent | IpcMainInvokeEvent,
  channel: string,
  limit: number
): boolean {
  return ipcRateLimiter.consume(event.sender.id, channel, limit);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampPointToDisplay(x: number, y: number): { x: number; y: number } {
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  const display = screen.getDisplayNearestPoint({ x: roundedX, y: roundedY });
  const { bounds } = display;

  return {
    x: clamp(roundedX, bounds.x, bounds.x + bounds.width - 1),
    y: clamp(roundedY, bounds.y, bounds.y + bounds.height - 1),
  };
}

function configurePermissionGuards(allowedOrigin: string): void {
  const isTrustedPermissionOrigin = (requestingUrl: string): boolean =>
    isAllowedNavigation(requestingUrl, allowedOrigin);

  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    permission === 'media' && isTrustedPermissionOrigin(requestingOrigin)
  );

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const requestingUrl = details.requestingUrl || webContents.getURL();
      callback(permission === 'media' && isTrustedPermissionOrigin(requestingUrl));
    }
  );
}

function releaseHeldMouseButtons(): void {
  const robot = getRobot();
  if (!robot || heldMouseButtons.size === 0) return;

  for (const button of heldMouseButtons) {
    try {
      robot.mouseToggle('up', button);
    } catch (err) {
      console.error(`Error releasing held ${button} mouse button:`, err);
    }
  }
  heldMouseButtons.clear();
}

const deadmanTimer = new DeadmanTimer(DEADMAN_TIMEOUT_MS, () => {
  logDiagnostic('deadman-timeout-fired-releasing-buttons');
  releaseHeldMouseButtons();
});

function restoreNormalBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setResizable(true);
    if (normalBounds) {
      mainWindow.setBounds(normalBounds);
      normalBounds = null;
    } else {
      mainWindow.setSize(1280, 800);
      mainWindow.center();
    }
  } catch (err) {
    console.error('Error restoring normal bounds:', err);
  }
}

function emergencyStop(): void {
  deadmanTimer.cancel();
  releaseHeldMouseButtons();
  restoreNormalBounds();
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('control:emergency-stop');
    } catch (err) {
      console.error('Error sending emergency-stop IPC to renderer:', err);
    }
  }
  logDiagnostic('emergency-stop-executed');
}

function createWindow(webUrl: string, allowedOrigin: string): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      additionalArguments: [`--app-token=${sessionAuthToken}`],
    },
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
    emergencyStop();
    console.error('Failed to load GestureBridge web app.', {
      errorCode,
      errorDescription,
      url: validatedUrl,
    });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    emergencyStop();
    console.error('GestureBridge renderer process exited.', details);
  });

  mainWindow.webContents.on('unresponsive', () => {
    emergencyStop();
    console.error('GestureBridge renderer became unresponsive.');
  });

  mainWindow.webContents.on('responsive', () => {
    logDiagnostic('renderer-responsive');
  });

  mainWindow.webContents.on('did-start-navigation', () => {
    emergencyStop();
  });

  void mainWindow.loadURL(webUrl).catch((error: unknown) => {
    console.error('Unable to start GestureBridge web app.', error);
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedNavigation(targetUrl, allowedOrigin)) {
      event.preventDefault();
      console.warn(`Blocked navigation to ${targetUrl}`);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedNavigation(url, allowedOrigin)) {
      console.warn(`Blocked new window to ${url}`);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.on('blur', () => {
    releaseHeldMouseButtons();
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    deadmanTimer.cancel();
    releaseHeldMouseButtons();
    ipcRateLimiter.clear();
    mainWindow = null;
  });
}

// Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.warn('Another instance of GestureBridge is already running. Exiting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    const webUrl = getWebUrl();
    const allowedOrigin = new URL(webUrl).origin;
    trustedOrigin = allowedOrigin;
    logDiagnostic('starting', {
      packaged: app.isPackaged,
      platform: process.platform,
      webOrigin: allowedOrigin,
      userDataPath: app.getPath('userData'),
    });

    try {
      const registered = globalShortcut.register('CommandOrControl+Escape', emergencyStop);
      if (!registered) {
        console.warn('Failed to register global shortcut CommandOrControl+Escape.');
      }
    } catch (err) {
      console.warn('Failed to register global emergency stop shortcut:', err);
    }

    screen.on('display-metrics-changed', () => logDiagnostic('display-metrics-changed'));
    screen.on('display-added', () => logDiagnostic('display-added'));
    screen.on('display-removed', () => logDiagnostic('display-removed'));

    configurePermissionGuards(allowedOrigin);
    createWindow(webUrl, allowedOrigin);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    deadmanTimer.cancel();
    releaseHeldMouseButtons();
    globalShortcut.unregisterAll();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    deadmanTimer.cancel();
    releaseHeldMouseButtons();
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      const webUrl = getWebUrl();
      trustedOrigin = new URL(webUrl).origin;
      createWindow(webUrl, trustedOrigin);
    }
  });
}

ipcMain.on('mouse:move', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'mouse:move', 120)) return;
  const pointPayload = parsePointPayload(payload);
  if (!pointPayload) return;

  const robot = getRobot();
  if (!robot) return;

  if (heldMouseButtons.size > 0) {
    deadmanTimer.heartbeat();
  }

  try {
    const point = clampPointToDisplay(pointPayload.x, pointPayload.y);
    robot.moveMouse(point.x, point.y);
  } catch (err) {
    console.error('Error moving mouse:', err);
  }
});

ipcMain.on('mouse:click', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'mouse:click', 30)) return;
  if (
    !isRecord(payload) ||
    (payload.button !== undefined && !isMouseButton(payload.button))
  ) {
    return;
  }

  const robot = getRobot();
  if (!robot) return;

  try {
    robot.mouseClick(payload.button ?? 'left');
  } catch (err) {
    console.error('Error clicking mouse:', err);
  }
});

ipcMain.on('mouse:scroll', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'mouse:scroll', 60)) return;
  if (typeof payload !== 'object' || payload === null || !('direction' in payload) || !isScrollDirection(payload.direction)) return;

  const robot = getRobot();
  if (!robot) return;

  try {
    robot.scrollMouse(0, payload.direction === 'up' ? 3 : -3);
  } catch (err) {
    console.error('Error scrolling mouse:', err);
  }
});

ipcMain.on('mouse:button', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload)) return;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('button' in payload) ||
    !('action' in payload) ||
    !isMouseToggleButton(payload.button) ||
    !isMouseAction(payload.action)
  ) {
    return;
  }

  // Allow button release ('up') to bypass rate limiting for safety
  if (payload.action !== 'up' && !consumeIpcRateLimit(event, 'mouse:button', 60)) {
    return;
  }

  const robot = getRobot();
  if (!robot) return;

  try {
    robot.mouseToggle(payload.action, payload.button);
    if (payload.action === 'down') {
      heldMouseButtons.add(payload.button);
      deadmanTimer.heartbeat();
    } else {
      heldMouseButtons.delete(payload.button);
      if (heldMouseButtons.size === 0) {
        deadmanTimer.cancel();
      }
    }
  } catch (err) {
    console.error('Error toggling mouse button:', err);
  }
});

ipcMain.on('zoom', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'zoom', 30)) return;
  if (typeof payload !== 'object' || payload === null || !('direction' in payload) || !isZoomDirection(payload.direction)) return;

  const robot = getRobot();
  if (!robot) return;

  const zoomModifier = process.platform === 'darwin' ? 'command' : 'control';
  try {
    robot.keyToggle(zoomModifier, 'down');
    robot.scrollMouse(0, payload.direction === 'in' ? -3 : 3);
  } catch (err) {
    console.error('Error zooming:', err);
  } finally {
    try {
      robot.keyToggle(zoomModifier, 'up');
    } catch (err) {
      console.error('Error releasing zoom modifier:', err);
    }
  }
});

ipcMain.handle('screen:size', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'screen:size', 30)) {
    throw new Error('Unauthorized IPC sender');
  }

  const robot = getRobot();
  if (robot) {
    try {
      return robot.getScreenSize();
    } catch (err) {
      console.error('Error getting screen size from robotjs:', err);
    }
  }

  const { bounds } = screen.getPrimaryDisplay();
  return { width: bounds.width, height: bounds.height };
});

ipcMain.on('window:set-compact', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'window:set-compact', 10)) return;
  if (
    !mainWindow ||
    typeof payload !== 'object' ||
    payload === null ||
    !('compact' in payload) ||
    typeof payload.compact !== 'boolean'
  ) {
    return;
  }

  try {
    if (payload.compact) {
      if (!normalBounds) {
        normalBounds = mainWindow.getBounds();
      }
      const currentBounds = mainWindow.getBounds();
      const display = screen.getDisplayMatching(currentBounds);
      const { workArea } = display;
      const width = 220;
      const height = 220;
      const x = Math.round(workArea.x + (workArea.width - width) / 2);
      const y = Math.round(workArea.y + 40);

      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setBounds({ x, y, width, height });
      mainWindow.setResizable(false);
    } else {
      restoreNormalBounds();
    }
  } catch (err) {
    console.error('Error toggling compact mode:', err);
  }
});

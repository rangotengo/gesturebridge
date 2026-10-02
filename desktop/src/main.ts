import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  session,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron';
import * as crypto from 'crypto';
import * as path from 'path';
import {
  DEADMAN_TIMEOUT_MS,
  DeadmanTimer,
  HeldButtonTracker,
  IpcRateLimiter,
  isAllowedLocalUrl,
  isAllowedMediaPermission,
  isAllowedNavigation,
  isMouseAction,
  isMouseButton,
  isMouseToggleButton,
  isScrollDirection,
  isTrustedOriginUrl,
  isValidAuthToken,
  isZoomDirection,
  parsePointPayload,
  resolvePointerDesktop,
  type DesktopBounds,
  type MouseButton,
  type MouseToggleButton,
} from './security';

interface RobotModule {
  moveMouse(x: number, y: number): void;
  dragMouse(x: number, y: number, button?: 'left' | 'right' | 'middle'): void;
  mouseClick(button?: 'left' | 'right' | 'middle', double?: boolean): void;
  mouseToggle(action: 'down' | 'up', button?: 'left' | 'right' | 'middle'): void;
  scrollMouse(x: number, y: number): void;
  keyToggle(key: string, action: 'down' | 'up'): void;
  getScreenSize(): { width: number; height: number };
  setMouseDelay(ms: number): void;
}

let mainWindow: BrowserWindow | null = null;
let normalBounds: Electron.Rectangle | null = null;
let robotModule: RobotModule | null | undefined;
let trustedOrigin = '';
const sessionAuthToken = crypto.randomBytes(32).toString('hex');
const heldMouseButtons = new HeldButtonTracker();

const ipcRateLimiter = new IpcRateLimiter();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function logDiagnostic(event: string, details: Record<string, unknown> = {}): void {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (!isDev) return;
  console.log(`[gesturebridge-desktop] ${event}`, details);
}

function getRobot(): RobotModule | null {
  if (robotModule !== undefined) return robotModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    robotModule = require('robotjs') as RobotModule;
    // robotjs sleeps after every mouse call. The default 10ms blocks the main
    // process long enough to stall a 60fps pointer stream and to glue click
    // down/up into one ignored event. Click timing is handled explicitly.
    try {
      robotModule.setMouseDelay(0);
    } catch (delayError) {
      console.warn('Unable to set robotjs mouse delay:', delayError);
    }
    return robotModule;
  } catch (err) {
    robotModule = null;
    console.warn('Native robotjs module is unavailable. Desktop control is disabled.', err);
    return null;
  }
}

function getWebUrl(): string {
  const configuredUrl = process.env.WEB_URL;
  const fallbackUrl = 'http://localhost:3000';

  if (!configuredUrl) return fallbackUrl;
  if (isAllowedLocalUrl(configuredUrl)) return configuredUrl;

  console.warn(`Blocked non-local WEB_URL "${configuredUrl}". Falling back to ${fallbackUrl}.`);
  return fallbackUrl;
}

function isTrustedIpcSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  payload: unknown
): boolean {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame?.parent) {
    logDiagnostic('ipc-rejected-window', {
      hasMainWindow: Boolean(mainWindow),
      sameSender: mainWindow ? event.sender === mainWindow.webContents : false,
      hasParent: Boolean(event.senderFrame?.parent),
    });
    return false;
  }

  const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
  if (!isTrustedOriginUrl(senderUrl, trustedOrigin)) {
    logDiagnostic('ipc-rejected-origin', { senderUrl, trustedOrigin });
    return false;
  }

  const validToken = isValidAuthToken(payload, sessionAuthToken);
  if (!validToken) {
    logDiagnostic('ipc-rejected-token', {
      hasToken: isRecord(payload) && typeof payload.token === 'string',
    });
    return false;
  }

  return true;
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

function currentDisplayBounds(): DesktopBounds[] {
  return screen.getAllDisplays().map((display) => display.bounds);
}

function currentRobotScreenSize(): { width: number; height: number } | null {
  const robot = getRobot();
  if (!robot) return null;
  try {
    const size = robot.getScreenSize();
    if (size.width > 0 && size.height > 0) return size;
  } catch (err) {
    console.error('Error getting screen size from robotjs:', err);
  }
  return null;
}

function pointerDesktopBounds(): DesktopBounds {
  const robotSize = process.platform === 'darwin' ? null : currentRobotScreenSize();
  return resolvePointerDesktop(process.platform, currentDisplayBounds(), robotSize);
}

const CLICK_SETTLE_MS = 20;
const CLICK_HOLD_MS = 45;

let lastCommandedPoint: { x: number; y: number } | null = null;
let deferredPoint: { x: number; y: number } | null = null;
let compactMode = false;
let accessibilityGranted = process.platform !== 'darwin';
let accessibilityWarningLogged = false;
let syntheticClickTimer: NodeJS.Timeout | null = null;
let syntheticClick: { button: MouseButton; phase: 'settle' | 'down' } | null = null;

function ensurePointerControl(): boolean {
  if (process.platform !== 'darwin') return true;
  if (accessibilityGranted) return true;

  try {
    accessibilityGranted = systemPreferences.isTrustedAccessibilityClient(true);
  } catch (err) {
    console.error('Error checking Accessibility permission:', err);
    return false;
  }

  if (!accessibilityGranted && !accessibilityWarningLogged) {
    accessibilityWarningLogged = true;
    console.warn(
      'GestureBridge needs Accessibility permission to move and click the pointer. Enable GestureBridge in System Settings > Privacy & Security > Accessibility.'
    );
  }

  return accessibilityGranted;
}

function cancelSyntheticClick(releaseIfDown: boolean): void {
  if (syntheticClickTimer) {
    clearTimeout(syntheticClickTimer);
    syntheticClickTimer = null;
  }

  const pending = syntheticClick;
  syntheticClick = null;
  if (releaseIfDown && pending?.phase === 'down') {
    try {
      getRobot()?.mouseToggle('up', pending.button);
    } catch (err) {
      console.error('Error releasing in-flight mouse click:', err);
    }
  }
  flushDeferredPoint();
}

function postPointer(robot: RobotModule, point: { x: number; y: number }): void {
  lastCommandedPoint = point;
  // macOS apps track a drag only from "dragged" events. A plain move with the
  // button down is ignored by Finder, text selection, and window dragging.
  const held = heldMouseButtons.getHeldButtons()[0];
  if (held) {
    robot.dragMouse(point.x, point.y, held);
  } else {
    robot.moveMouse(point.x, point.y);
  }
}

function flushDeferredPoint(): void {
  const point = deferredPoint;
  deferredPoint = null;
  if (!point) return;
  const robot = getRobot();
  if (!robot) return;
  try {
    postPointer(robot, point);
  } catch (err) {
    console.error('Error applying deferred pointer move:', err);
  }
}

function commandPointerMove(robot: RobotModule, x: number, y: number): void {
  const clamped = clampPointToDisplay(x, y);
  if (syntheticClick) {
    // Moving between press and release would turn the click into a tiny drag.
    deferredPoint = clamped;
    return;
  }
  postPointer(robot, clamped);
}

function commandPointerClick(robot: RobotModule, button: MouseButton): void {
  if (syntheticClick) return;
  if (button !== 'middle' && heldMouseButtons.has(button)) return;

  // robotjs clicks at getMousePos(), which lags the last moveMouse, and it
  // posts button down and up back to back. Park on the last commanded point,
  // let that move land, then hold the button long enough for the OS to see it.
  syntheticClick = { button, phase: 'settle' };
  syntheticClickTimer = setTimeout(() => {
    if (syntheticClick?.button !== button) {
      cancelSyntheticClick(false);
      return;
    }

    if (lastCommandedPoint) {
      try {
        robot.moveMouse(lastCommandedPoint.x, lastCommandedPoint.y);
      } catch (err) {
        console.error('Error repositioning pointer before click:', err);
      }
    }

    syntheticClickTimer = setTimeout(() => {
      if (syntheticClick?.button !== button) {
        cancelSyntheticClick(false);
        return;
      }

      try {
        robot.mouseToggle('down', button);
      } catch (err) {
        console.error('Error pressing mouse button:', err);
        cancelSyntheticClick(false);
        return;
      }

      syntheticClick = { button, phase: 'down' };
      syntheticClickTimer = setTimeout(() => {
        syntheticClickTimer = null;
        syntheticClick = null;
        try {
          getRobot()?.mouseToggle('up', button);
        } catch (err) {
          console.error('Error releasing mouse click:', err);
        }
        flushDeferredPoint();
      }, CLICK_HOLD_MS);
    }, CLICK_SETTLE_MS);
  }, CLICK_SETTLE_MS);
}

function configurePermissionGuards(allowedOrigin: string): void {
  const isTrustedPermissionOrigin = (requestingUrl: string): boolean => {
    if (!requestingUrl) return false;
    return isAllowedNavigation(requestingUrl, allowedOrigin);
  };

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const originToCheck = requestingOrigin || webContents?.getURL() || '';
    const isAllowed =
      isAllowedMediaPermission(permission) && isTrustedPermissionOrigin(originToCheck);
    logDiagnostic('permission-check', { permission, requestingOrigin, originToCheck, isAllowed });
    return isAllowed;
  });

  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const requestingUrl = details.requestingUrl || webContents?.getURL() || '';
      const isAllowed =
        isAllowedMediaPermission(permission) && isTrustedPermissionOrigin(requestingUrl);
      const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
      logDiagnostic('permission-request', {
        permission,
        requestingUrl,
        isAllowed,
        mediaTypes,
      });
      callback(isAllowed);
    }
  );
}

async function ensureDarwinMediaAccess(): Promise<{ camera: boolean; microphone: boolean }> {
  if (process.platform !== 'darwin') {
    return { camera: true, microphone: true };
  }

  let cameraGranted = false;
  let microphoneGranted = false;

  try {
    const cameraStatus = systemPreferences.getMediaAccessStatus('camera');
    logDiagnostic('darwin-camera-status-check', { cameraStatus });

    if (cameraStatus === 'granted') {
      cameraGranted = true;
    } else if (cameraStatus === 'not-determined') {
      cameraGranted = await systemPreferences.askForMediaAccess('camera');
      logDiagnostic('darwin-camera-prompt-result', { cameraGranted });
    } else {
      logDiagnostic('darwin-camera-blocked-by-os', { cameraStatus });
    }
  } catch (err) {
    console.error('Error querying macOS camera access:', err);
  }

  try {
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    logDiagnostic('darwin-mic-status-check', { micStatus });

    if (micStatus === 'granted') {
      microphoneGranted = true;
    } else if (micStatus === 'not-determined') {
      microphoneGranted = await systemPreferences.askForMediaAccess('microphone');
      logDiagnostic('darwin-mic-prompt-result', { microphoneGranted });
    } else {
      logDiagnostic('darwin-mic-blocked-by-os', { micStatus });
    }
  } catch (err) {
    console.error('Error querying macOS microphone access:', err);
  }

  return { camera: cameraGranted, microphone: microphoneGranted };
}

function releaseHeldMouseButtons(reason: string = 'manual'): void {
  cancelSyntheticClick(true);
  const result = heldMouseButtons.releaseAll(reason);
  if (!result) return;

  const robot = getRobot();
  for (const button of result.buttons) {
    try {
      robot?.mouseToggle('up', button);
    } catch (err) {
      console.error(`Error releasing mouse button ${button}:`, err);
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.webContents.send('mouse:drag-released', result);
    } catch (err) {
      console.error('Error notifying renderer of drag release:', err);
    }
  }
}

const deadmanTimer = new DeadmanTimer(DEADMAN_TIMEOUT_MS, () => {
  logDiagnostic('deadman-timeout-fired-releasing-buttons');
  releaseHeldMouseButtons('deadman-timeout');
});

function restoreNormalBounds(): void {
  compactMode = false;
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
  releaseHeldMouseButtons('emergency-stop');
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
    frame: true,
    transparent: false,
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      // Mouse control runs while other apps have focus; throttled timers stall the camera loop.
      backgroundThrottling: false,
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

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url, allowedOrigin)) {
      return { action: 'allow' };
    }
    logDiagnostic('blocked-window-open', { url });
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, allowedOrigin)) {
      return;
    }
    logDiagnostic('blocked-navigation', { url });
    event.preventDefault();
  });

  mainWindow.on('blur', () => {
    // In mouse control every press into another app blurs this window, so a
    // blur release would end each drag as it starts. The deadman timer and
    // the emergency shortcut still cover that mode.
    if (compactMode) return;
    releaseHeldMouseButtons('window-blur');
  });

  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  if (isDev) {
    // Detached tools keep the compact window's bounds equal to the camera.
    // A docked drawer would shrink the page inside the small overlay.
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    deadmanTimer.cancel();
    releaseHeldMouseButtons('window-closed');
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
    void ensureDarwinMediaAccess();
    createWindow(webUrl, allowedOrigin);
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    deadmanTimer.cancel();
    releaseHeldMouseButtons('app-before-quit');
    globalShortcut.unregisterAll();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    deadmanTimer.cancel();
    releaseHeldMouseButtons('app-will-quit');
  });

  app.on('activate', () => {
    if (mainWindow === null) {
      const webUrl = getWebUrl();
      trustedOrigin = new URL(webUrl).origin;
      createWindow(webUrl, trustedOrigin);
    }
  });
}

ipcMain.handle('system:request-media-access', async (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'system:request-media-access', 10)) {
    return { success: false, camera: false, microphone: false, reason: 'untrusted-sender' };
  }
  const result = await ensureDarwinMediaAccess();
  return { success: true, ...result };
});

ipcMain.handle('system:get-media-status', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'system:get-media-status', 20)) {
    return { camera: 'unknown', microphone: 'unknown' };
  }
  if (process.platform !== 'darwin') {
    return { camera: 'granted', microphone: 'granted' };
  }
  return {
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
  };
});

ipcMain.handle('system:accessibility-status', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'system:accessibility-status', 20)) {
    return { trusted: false };
  }
  if (process.platform !== 'darwin') return { trusted: true };
  try {
    const trusted = systemPreferences.isTrustedAccessibilityClient(false);
    if (trusted) accessibilityGranted = true;
    return { trusted };
  } catch (err) {
    console.error('Error reading Accessibility permission:', err);
    return { trusted: false };
  }
});

ipcMain.on('mouse:move', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'mouse:move', 120)) return;
  const pointPayload = parsePointPayload(payload);
  if (!pointPayload) return;
  if (!ensurePointerControl()) return;

  const robot = getRobot();
  if (!robot) return;

  try {
    commandPointerMove(robot, pointPayload.x, pointPayload.y);
    if (heldMouseButtons.getHeldButtons().length > 0) {
      deadmanTimer.heartbeat();
    }
  } catch (err) {
    console.error('Error moving mouse:', err);
  }
});

ipcMain.on('mouse:click', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'mouse:click', 60)) return;
  if (!isRecord(payload)) return;

  const button = 'button' in payload ? payload.button : 'left';
  if (button !== undefined && !isMouseButton(button)) {
    return;
  }
  if (!ensurePointerControl()) return;

  const robot = getRobot();
  if (!robot) return;

  try {
    commandPointerClick(robot, button ?? 'left');
  } catch (err) {
    console.error('Error clicking mouse:', err);
  }
});

ipcMain.on('mouse:scroll', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload) || !consumeIpcRateLimit(event, 'mouse:scroll', 60)) return;
  if (typeof payload !== 'object' || payload === null || !('direction' in payload) || !isScrollDirection(payload.direction)) return;

  if (!ensurePointerControl()) return;

  const robot = getRobot();
  if (!robot) return;

  try {
    robot.scrollMouse(0, payload.direction === 'up' ? -7 : 7);
  } catch (err) {
    console.error('Error scrolling:', err);
  }
});

ipcMain.on('mouse:button', (event, payload: unknown) => {
  if (!isTrustedIpcSender(event, payload)) return;
  if (!isRecord(payload)) return;

  const button = payload.button;
  const action = payload.action;
  if (!isMouseToggleButton(button) || !isMouseAction(action)) {
    return;
  }

  // Allow button release ('up') to bypass rate limiting for safety
  if (action !== 'up' && !consumeIpcRateLimit(event, 'mouse:button', 60)) {
    return;
  }

  if (!ensurePointerControl()) return;
  cancelSyntheticClick(true);

  const robot = getRobot();
  if (!robot) return;

  try {
    robot.mouseToggle(action, button);
    if (action === 'down') {
      heldMouseButtons.press(button);
      deadmanTimer.heartbeat();
    } else {
      heldMouseButtons.release(button);
      if (heldMouseButtons.getHeldButtons().length === 0) {
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

  if (!ensurePointerControl()) return;

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
  if (!isTrustedIpcSender(event, payload)) {
    throw new Error('Unauthorized IPC sender');
  }
  if (!consumeIpcRateLimit(event, 'screen:size', 60)) {
    throw new Error('Rate limit exceeded for channel: screen:size');
  }

  return pointerDesktopBounds();
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
      const { workArea } = screen.getPrimaryDisplay();
      // Keep the camera content at 16:9, allowing space for the native frame.
      const [outerWidth, outerHeight] = mainWindow.getSize();
      const [contentWidth, contentHeight] = mainWindow.getContentSize();
      const width = 480 + outerWidth - contentWidth;
      const height = 270 + outerHeight - contentHeight;
      const x = workArea.x + workArea.width - width - 16;
      const y = workArea.y + workArea.height - height - 16;

      mainWindow.setAlwaysOnTop(true, 'floating');
      mainWindow.setBounds({ x, y, width, height });
      mainWindow.setResizable(false);
      compactMode = true;
    } else {
      restoreNormalBounds();
    }
  } catch (err) {
    console.error('Error toggling compact mode:', err);
  }
});

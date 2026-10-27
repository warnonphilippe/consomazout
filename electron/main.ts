import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, nativeTheme, net, protocol, safeStorage, session, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { APP_HOST, APP_SCHEME, assetFileUrl, buildContentSecurityPolicy } from './app-protocol';
import { AiService, sdkClientFactory } from './ai';
import { SecretStore, type Cipher } from './secrets';
import { DataFileStore } from './storage';
import { IPC, type AiChatRequest, type AiStatus, type ExportKind, type ThemeMode } from './shared/ipc-contract';

/** URL du serveur de développement Angular, honorée uniquement hors application packagée. */
const DEV_URL = !app.isPackaged ? (process.env['CONSOMAZOUT_DEV_URL'] ?? null) : null;
const DEV_ORIGIN = DEV_URL === null ? null : new URL(DEV_URL).origin;
const RENDERER_ROOT = join(__dirname, '..', 'dist', 'consomazout', 'browser');
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const CSP = buildContentSecurityPolicy(DEV_ORIGIN);
const MAX_CONTENT_LENGTH = 50 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 100_000;
const MAX_SYSTEM_LENGTH = 2_000_000;
const MODEL_PATTERN = /^claude-[a-z0-9.-]{1,60}$/;

/** Développement uniquement : adresse d'une API Claude de test (serveur local simulé). */
const DEV_API_URL = !app.isPackaged ? process.env['CONSOMAZOUT_API_URL'] : undefined;
/** Développement uniquement : chiffrement factice de la clé, pour les tests automatisés sans Trousseau. */
const DEV_TEST_CIPHER = !app.isPackaged && process.env['CONSOMAZOUT_TEST_CIPHER'] === '1';

// Développement uniquement : dossier de données isolé pour les essais.
const DEV_USER_DATA = !app.isPackaged ? process.env['CONSOMAZOUT_USER_DATA'] : undefined;
if (DEV_USER_DATA !== undefined) {
  app.setPath('userData', DEV_USER_DATA);
}

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } },
]);

let mainWindow: BrowserWindow | null = null;

const BACKGROUND = { dark: '#0f172a', light: '#f1f5f9' } as const;

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function backgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? BACKGROUND.dark : BACKGROUND.light;
}

/** Seules la page de l'application (ou le serveur de dev) peuvent appeler le process principal. */
function fromApp(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url.startsWith(`${APP_ORIGIN}/`) || (DEV_ORIGIN !== null && url.startsWith(`${DEV_ORIGIN}/`));
}

function assertString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Paramètre invalide : ${name}`);
  }
  return value;
}

function assertModel(value: unknown): string {
  if (typeof value !== 'string' || !MODEL_PATTERN.test(value)) {
    throw new Error('Paramètre invalide : modèle');
  }
  return value;
}

function assertChat(value: unknown): AiChatRequest {
  const request = value as Partial<AiChatRequest> | null;
  if (request === null || typeof request !== 'object' || !Array.isArray(request.messages) || request.messages.length > 200) {
    throw new Error('Paramètre invalide : conversation');
  }
  const messages = request.messages.map((m) => {
    if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || m.content.length > MAX_MESSAGE_LENGTH) {
      throw new Error('Paramètre invalide : message');
    }
    return { role: m.role, content: m.content };
  });
  if (typeof request.system !== 'string' || request.system.length > MAX_SYSTEM_LENGTH) {
    throw new Error('Paramètre invalide : contexte');
  }
  return {
    requestId: assertString(request.requestId, 'requestId').slice(0, 100),
    model: assertModel(request.model),
    system: request.system,
    messages,
  };
}

const testCipher: Cipher = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(Buffer.from(plain, 'utf-8').toString('base64').split('').reverse().join(''), 'utf-8'),
  decryptString: (encrypted) => Buffer.from(encrypted.toString().split('').reverse().join(''), 'base64').toString('utf-8'),
};

function handle(channel: string, handler: (...args: unknown[]) => unknown): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!fromApp(event)) {
      throw new Error('Appel refusé');
    }
    return handler(...args);
  });
}

function registerIpc(store: DataFileStore, secrets: SecretStore, ai: AiService): void {
  handle(IPC.load, () => store.load());
  handle(IPC.save, (content) => store.save(assertString(content, 'content')));

  handle(IPC.exportFile, async (content, suggestedName, kind) => {
    const text = assertString(content, 'content');
    const name = assertString(suggestedName, 'suggestedName').replace(/[\\/]/g, '_');
    const exportKind: ExportKind = kind === 'csv' ? 'csv' : 'json';
    const options = {
      defaultPath: join(app.getPath('documents'), name),
      filters:
        exportKind === 'csv'
          ? [{ name: 'CSV', extensions: ['csv'] }]
          : [{ name: 'Données ConsoMazout', extensions: ['json'] }],
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return null;
    }
    await writeFile(result.filePath, text, 'utf-8');
    return result.filePath;
  });

  handle(IPC.importFile, async () => {
    const options = {
      properties: ['openFile' as const],
      filters: [{ name: 'Données ConsoMazout', extensions: ['json'] }],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    const file = result.filePaths[0];
    if (result.canceled || file === undefined) {
      return null;
    }
    return assertString(await readFile(file, 'utf-8'), 'fichier');
  });

  handle(IPC.reveal, () => shell.showItemInFolder(store.path));

  const aiStatus = async (): Promise<AiStatus> => ({
    hasKey: await secrets.hasKey(),
    encryptionAvailable: secrets.encryptionAvailable,
  });
  handle(IPC.aiStatus, aiStatus);
  handle(IPC.aiSetKey, async (key) => {
    if (key === null) {
      await secrets.clear();
    } else {
      await secrets.set(assertString(key, 'clé'));
    }
    return aiStatus();
  });
  handle(IPC.aiTest, (model) => ai.test(assertModel(model)));
  handle(IPC.aiAbort, (requestId) => ai.abort(assertString(requestId, 'requestId')));
  ipcMain.handle(IPC.aiChat, (event, request: unknown) => {
    if (!fromApp(event)) {
      throw new Error('Appel refusé');
    }
    // Le flux est relayé à la page qui l'a demandé ; la promesse se termine à la fin du flux.
    return ai.chat(assertChat(request), (payload) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(IPC.aiEvent, payload);
      }
    });
  });

  handle(IPC.theme, (mode) => {
    nativeTheme.themeSource = isThemeMode(mode) ? mode : 'system';
    mainWindow?.setBackgroundColor(backgroundColor());
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    title: 'ConsoMazout',
    backgroundColor: backgroundColor(),
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  // Liens externes (sources des statistiques) : ouverts dans le navigateur par défaut.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  void window.loadURL(DEV_URL ?? `${APP_ORIGIN}/index.html`);
  return window;
}

function bootstrap(): void {
  const store = new DataFileStore(join(app.getPath('userData'), 'consomazout.json'));
  const savedTheme = store.readThemeSync();
  nativeTheme.themeSource = isThemeMode(savedTheme) ? savedTheme : 'system';

  protocol.handle(APP_SCHEME, async (request) => {
    const response = await net.fetch(assetFileUrl(RENDERER_ROOT, request.url));
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    // index.html jamais mis en cache : une nouvelle version de l'app charge toujours ses nouveaux fichiers.
    if (headers.get('Content-Type')?.startsWith('text/html')) {
      headers.set('Cache-Control', 'no-store');
    }
    return new Response(response.body, { status: response.status, headers });
  });

  const defaultSession = session.defaultSession;
  defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  defaultSession.setPermissionCheckHandler(() => false);
  if (DEV_ORIGIN !== null) {
    defaultSession.webRequest.onHeadersReceived({ urls: [`${DEV_ORIGIN}/*`] }, (details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
    });
  }

  // Clé API chiffrée par le système (Trousseau macOS / DPAPI Windows), dans un fichier distinct des données.
  const secrets = new SecretStore(join(app.getPath('userData'), 'secrets.bin'), DEV_TEST_CIPHER ? testCipher : safeStorage);
  const ai = new AiService(() => secrets.get(), sdkClientFactory(DEV_API_URL));
  registerIpc(store, secrets, ai);

  const openWindow = (): void => {
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  };
  openWindow();
  app.on('activate', () => {
    if (mainWindow === null) {
      openWindow();
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
  void app.whenReady().then(bootstrap);
  app.on('window-all-closed', () => app.quit());
}

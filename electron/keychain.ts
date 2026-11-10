import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const SECURITY = '/usr/bin/security';
/** `security` : élément introuvable. */
const NOT_FOUND = 44;

/** Caractères admis dans une valeur : aucun échappement nécessaire dans la ligne de commande interactive. */
const SAFE_VALUE = /^[A-Za-z0-9._~+/=-]{8,400}$/;
const SAFE_TEXT = /^[^"\\\n\r]{1,200}$/;

export interface KeychainItem {
  readonly service: string;
  readonly account: string;
  /** Nom affiché dans Trousseau d'accès. */
  readonly label: string;
}

/** Valeur acceptable pour le Trousseau (clé API, clé WPA2-PSK…). */
export function isSafeSecret(value: string): boolean {
  return SAFE_VALUE.test(value);
}

/**
 * Mots de passe génériques du Trousseau macOS, par l'outil `/usr/bin/security` (aucun module natif). Les éléments
 * sont visibles et modifiables dans Trousseau d'accès ; leur accès est accordé à l'outil `security`, il ne dépend donc
 * pas de la signature de l'application. `keychain` : fichier de trousseau précis (tests), sinon le trousseau par défaut.
 */
export class Keychain {
  constructor(private readonly keychain?: string) {}

  /** Valeur de l'élément, ou `null` s'il n'existe pas. */
  get(item: KeychainItem): Promise<string | null> {
    return new Promise((resolve, reject) => {
      execFile(
        SECURITY,
        ['find-generic-password', '-s', item.service, '-a', item.account, '-w', ...this.target()],
        { timeout: 10_000 },
        (error, stdout, stderr) => {
          if (error) {
            if ((error as { code?: unknown }).code === NOT_FOUND) {
              resolve(null);
            } else {
              reject(new Error(`Trousseau illisible : ${String(stderr).trim() || error.message}`));
            }
            return;
          }
          resolve(stdout.replace(/\n$/, ''));
        },
      );
    });
  }

  /**
   * Crée ou remplace l'élément. La commande est écrite sur l'entrée standard de `security -i` : la valeur n'apparaît
   * jamais dans les arguments d'un processus. `security -i` ne signale pas toujours un échec (il écrit même dans le
   * trousseau par défaut si le trousseau demandé n'existe pas) : la valeur est relue pour vérifier l'écriture.
   */
  async set(item: KeychainItem, value: string): Promise<void> {
    await this.write(item, value);
    if ((await this.get(item)) !== value) {
      throw new Error('Écriture dans le Trousseau non confirmée.');
    }
  }

  private write(item: KeychainItem, value: string): Promise<void> {
    if (!isSafeSecret(value)) {
      return Promise.reject(new Error('Cette clé contient des caractères inattendus ou n’a pas la bonne longueur.'));
    }
    if (![item.service, item.account, item.label, ...this.target()].every((t) => SAFE_TEXT.test(t))) {
      return Promise.reject(new Error('Élément de trousseau invalide.'));
    }
    if (this.keychain && !existsSync(this.keychain)) {
      return Promise.reject(new Error(`Trousseau introuvable : ${this.keychain}`));
    }
    const target = this.keychain ? ` "${this.keychain}"` : '';
    const command =
      `add-generic-password -U -s "${item.service}" -a "${item.account}" -l "${item.label}" ` +
      `-w "${value}"${target}\n`;
    return new Promise((resolve, reject) => {
      const child = spawn(SECURITY, ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => child.kill(), 10_000);
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`Trousseau inaccessible : ${e.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        // `security -i` sort avec le code 0 même si la commande a échoué : on se fie à sa sortie d'erreur.
        if (code === 0 && stderr.trim() === '') {
          resolve();
        } else {
          reject(new Error(`Écriture dans le Trousseau impossible : ${stderr.trim() || `code ${code}`}`));
        }
      });
      child.stdin.end(command);
    });
  }

  /** Supprime l'élément (sans erreur s'il n'existe pas). */
  delete(item: KeychainItem): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(
        SECURITY,
        ['delete-generic-password', '-s', item.service, '-a', item.account, ...this.target()],
        { timeout: 10_000 },
        (error, _stdout, stderr) => {
          if (error && (error as { code?: unknown }).code !== NOT_FOUND) {
            reject(new Error(`Suppression dans le Trousseau impossible : ${String(stderr).trim() || error.message}`));
          } else {
            resolve();
          }
        },
      );
    });
  }

  private target(): string[] {
    return this.keychain ? [this.keychain] : [];
  }
}

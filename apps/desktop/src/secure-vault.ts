/**
 * The protected vault (docs/ARCHITECTURE.md "Desktop protection"): the owner's whole vault lives in a macOS AES-256
 * encrypted APFS sparsebundle. Its random passphrase is wrapped three ways — by the app password, by a recovery key
 * shown once, and (optionally) by Touch ID through the Keychain — and never goes into arguments, environment or logs.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { wrapKey, unwrapKey, type WrappedKey } from './protection';
import { formatRecoveryKey, normalizeRecoveryKey } from './shell';

interface Metadata {
  version: 1;
  id: string;
  password: WrappedKey;
  /** The same passphrase under the recovery key (created at setup, or at the first unlock of an older install). */
  recovery?: WrappedKey;
  /** The same passphrase under the Keychain (Touch ID). */
  biometric?: string;
  /** When the password was last typed (Touch ID alone is refused once it is too old). */
  passwordAt?: string;
  /** When the encrypted backup copy was last refreshed. */
  backupAt?: string;
  migrated: boolean;
  sourceHash?: string;
  cleanupComplete?: boolean;
  backupReady?: boolean;
}

/** Why an unlock or a lock failed, for the lock page's words and the shell log. */
export type VaultErrorCode = 'password' | 'recovery' | 'touch-id' | 'disk-busy' | 'missing' | 'storage' | 'migration';
export class VaultError extends Error {
  constructor(readonly code: VaultErrorCode, message: string) { super(message); }
}

/** The child never receives a secret in its arguments, environment or an error message. */
export function runPrivate(binary: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const output: Buffer[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new VaultError('storage', 'Storage operation timed out.')); }, 180_000);
    child.stdout.on('data', (b: Buffer) => output.push(b));
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(new VaultError('storage', 'Storage helper could not start.')); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(output));
      else reject(new VaultError('storage', `${path.basename(binary)} ${args[0] ?? ''} failed (exit ${code ?? '?'}).`));
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; }
}
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A hash over every name and byte of a folder, hidden files included; a link or a special file stops it. */
export async function fingerprint(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function walk(dir: string, rel: string): Promise<void> {
    for (const name of (await readdir(dir)).sort()) {
      const file = path.join(dir, name);
      const key = path.join(rel, name);
      const s = await lstat(file);
      if (s.isSymbolicLink() || (!s.isDirectory() && !s.isFile())) throw new VaultError('migration', 'The vault contains a link or unsupported file; migration stopped safely.');
      hash.update(JSON.stringify([key, s.isDirectory() ? 'dir' : 'file']));
      if (s.isDirectory()) await walk(file, key);
      else hash.update(createHash('sha256').update(await readFile(file)).digest());
    }
  }
  await walk(root, '');
  return hash.digest('hex');
}

export interface Biometrics { wrap: (key: Buffer) => Promise<Buffer>; unwrap: (cipher: Buffer) => Promise<Buffer> }
export interface UnlockResult { /** A recovery key made by this unlock: show it to the owner once. */ recoveryKey?: string }

export class SecureVault {
  readonly mount: string;
  readonly vault: string;
  readonly image: string;
  readonly config: string;
  readonly backup: string;
  readonly backupKey: string;

  constructor(readonly data: string, readonly biometrics: Biometrics, readonly legacyLogs?: string) {
    this.mount = path.join(data, 'private-volume');
    this.vault = path.join(this.mount, 'vault');
    this.image = path.join(data, 'protected.sparsebundle');
    this.config = path.join(data, 'protection.json');
    this.backup = path.join(data, 'migration-backup.sparsebundle');
    this.backupKey = path.join(data, 'migration-backup-key.json');
  }

  async configured(): Promise<boolean> { return exists(this.config); }

  private async metadata(): Promise<Metadata> {
    const m = JSON.parse(await readFile(this.config, 'utf8')) as Metadata;
    if (m.version !== 1 || typeof m.id !== 'string' || !m.password) throw new VaultError('missing', 'Protection metadata is invalid; restore the encrypted backup.');
    return m;
  }

  private async writeJson(file: string, m: Metadata): Promise<void> {
    const f = await open(`${file}.tmp`, 'w', 0o600);
    try { await f.writeFile(JSON.stringify(m)); await f.sync(); } finally { await f.close(); }
    await rename(`${file}.tmp`, file);
  }

  /** Saves the metadata; once the backup exists its key file follows, so a new password or recovery key opens it too. */
  private async save(m: Metadata): Promise<void> {
    await this.writeJson(this.config, m);
    if (m.backupReady && await exists(this.backup)) await this.writeJson(this.backupKey, m);
  }

  async biometricAvailable(): Promise<boolean> { return Boolean((await this.metadata()).biometric); }
  async passwordTypedAt(): Promise<string | undefined> { return (await this.metadata()).passwordAt; }
  async hasRecovery(): Promise<boolean> { return Boolean((await this.metadata()).recovery); }

  async mounted(): Promise<boolean> {
    if (!await exists(this.mount)) return false;
    return (await stat(this.data)).dev !== (await stat(this.mount)).dev;
  }

  /**
   * Unmounts the volume if it is mounted. A file still open on it (a terminal in the vault, a CLI finishing) makes
   * macOS refuse: it is tried again for a few seconds, and `force` unmounts whatever holds it.
   */
  async seal(opts: { force?: boolean; tries?: number } = {}): Promise<void> {
    const tries = opts.tries ?? 5;
    for (let i = 0; i < tries; i++) {
      if (!await this.mounted()) return;
      try { await runPrivate('/usr/bin/hdiutil', ['detach', this.mount, ...(opts.force && i === tries - 1 ? ['-force'] : [])]); return; }
      catch { await sleep(1000); }
    }
    if (await this.mounted()) throw new VaultError('disk-busy', 'The private disk is still in use and could not be closed.');
  }

  private async attach(secret: Buffer): Promise<void> {
    await this.seal();
    await mkdir(this.mount, { recursive: true, mode: 0o700 });
    try {
      await runPrivate('/usr/bin/hdiutil', ['attach', this.image, '-stdinpass', '-nobrowse', '-owners', 'on', '-mountpoint', this.mount], Buffer.concat([secret, Buffer.from([0])]));
    } catch (e) {
      throw new VaultError('storage', `The private disk could not be opened: ${(e as Error).message}`);
    }
    if (!await this.mounted()) throw new VaultError('storage', 'The private disk did not open at its place.');
    await chmod(this.mount, 0o700);
    await writeFile(path.join(this.mount, '.metadata_never_index'), '', { mode: 0o600 });
  }

  private createImage(secret: Buffer): Promise<Buffer> {
    return runPrivate('/usr/bin/hdiutil', ['create', '-size', '64g', '-type', 'SPARSEBUNDLE', '-fs', 'APFS', '-volname', 'Synapse Private', '-encryption', 'AES-256', '-stdinpass', this.image], Buffer.concat([secret, Buffer.from([0])]));
  }

  /** A recovery key for the passphrase, saved wrapped; the key itself is returned to be shown once. */
  private async addRecovery(m: Metadata, secret: Buffer): Promise<string> {
    const key = formatRecoveryKey(randomBytes(20));
    m.recovery = await wrapKey(secret, key);
    await this.save(m);
    return key;
  }

  async setup(password: string): Promise<UnlockResult> {
    if (await this.configured() || await exists(this.image)) throw new VaultError('storage', 'Protection already exists. Unlock it instead of replacing it.');
    const secret = Buffer.from(randomBytes(48).toString('base64url'));
    const m: Metadata = { version: 1, id: randomUUID(), password: await wrapKey(secret, password), passwordAt: new Date().toISOString(), migrated: false };
    try {
      await mkdir(this.data, { recursive: true, mode: 0o700 });
      await this.save(m);
      const recoveryKey = await this.addRecovery(m, secret);
      await this.createImage(secret);
      await chmod(this.image, 0o700);
      await this.attach(secret);
      await this.migrate(m, secret);
      return { recoveryKey };
    } finally { secret.fill(0); }
  }

  /** Opens with the password, or with Touch ID when no password is given. */
  async unlock(password?: string): Promise<UnlockResult> {
    const m = await this.metadata();
    let secret: Buffer;
    if (password !== undefined) {
      try { secret = await unwrapKey(m.password, password); } catch { throw new VaultError('password', 'Wrong password.'); }
      m.passwordAt = new Date().toISOString();
    } else if (m.biometric) {
      try { secret = await this.biometrics.unwrap(Buffer.from(m.biometric, 'base64')); } catch { throw new VaultError('touch-id', 'Touch ID did not open Synapse.'); }
      m.passwordAt ??= new Date().toISOString(); // an older install: the 14 days start now
    } else throw new VaultError('password', 'Unlock with your app password first.');
    return this.open(m, secret);
  }

  /** Opens with the recovery key and replaces the forgotten password with a new one. */
  async recover(recoveryKey: string, newPassword: string): Promise<UnlockResult> {
    const m = await this.metadata();
    const key = normalizeRecoveryKey(recoveryKey);
    if (!key || !m.recovery) throw new VaultError('recovery', 'That is not this Mac\'s recovery key.');
    let secret: Buffer;
    try { secret = await unwrapKey(m.recovery, key); } catch { throw new VaultError('recovery', 'That is not this Mac\'s recovery key.'); }
    m.password = await wrapKey(secret, newPassword);
    m.passwordAt = new Date().toISOString();
    return this.open(m, secret);
  }

  /** Replaces the password; the current password or the recovery key proves it is the owner. Works while locked. */
  async changePassword(current: string, next: string): Promise<void> {
    const m = await this.metadata();
    const key = normalizeRecoveryKey(current);
    let secret: Buffer;
    try { secret = key && m.recovery ? await unwrapKey(m.recovery, key) : await unwrapKey(m.password, current); }
    catch { throw new VaultError('password', 'Wrong password.'); }
    try {
      m.password = await wrapKey(secret, next);
      m.passwordAt = new Date().toISOString();
      await this.save(m);
    } finally { secret.fill(0); }
  }

  /** Turns Touch ID off: only the password (or the recovery key) opens Synapse afterwards. */
  async disableBiometric(password: string): Promise<void> {
    const m = await this.metadata();
    try { (await unwrapKey(m.password, password)).fill(0); } catch { throw new VaultError('password', 'Wrong password.'); }
    delete m.biometric;
    await this.save(m);
  }

  private async open(m: Metadata, secret: Buffer): Promise<UnlockResult> {
    try {
      // If first-time image creation was interrupted, retry without replacing any existing image.
      if (!await exists(this.image)) {
        if (m.migrated) throw new VaultError('missing', 'Encrypted data is missing. Restore your encrypted backup; no new vault was created.');
        await this.createImage(secret);
      }
      await this.save(m);
      await this.attach(secret);
      await this.migrate(m, secret);
      return m.recovery ? {} : { recoveryKey: await this.addRecovery(m, secret) };
    } finally { secret.fill(0); }
  }

  private async migrate(m: Metadata, secret: Buffer): Promise<void> {
    const original = path.join(this.data, 'vault');
    if (!m.migrated) {
      if (await exists(original)) {
        const before = await fingerprint(original);
        await rm(this.vault, { recursive: true, force: true });
        await cp(original, this.vault, { recursive: true, preserveTimestamps: true });
        if (before !== await fingerprint(this.vault) || before !== await fingerprint(original)) throw new VaultError('migration', 'Migration verification failed. Original files are unchanged.');
        // A complete, verified recovery copy lives inside the encrypted volume, outside the working vault.
        await rm(path.join(this.mount, 'migration-recovery'), { recursive: true, force: true });
        await cp(this.vault, path.join(this.mount, 'migration-recovery'), { recursive: true, preserveTimestamps: true });
        if (before !== await fingerprint(path.join(this.mount, 'migration-recovery'))) throw new VaultError('migration', 'Recovery copy verification failed.');
        m.sourceHash = before; m.migrated = true; await this.save(m);
      } else { m.migrated = true; await this.save(m); }
    }
    // Existing plaintext shell cache, environment and logs belong inside the encrypted recovery copy too.
    if (!m.cleanupComplete && !m.backupReady) {
      for (const [name, source] of [['shell', path.join(this.data, 'shell')], ['environment', path.join(this.data, 'synapse.env')], ['logs', this.legacyLogs ?? path.join(this.data, 'logs')]] as const) {
        if (!await exists(source)) continue;
        const destination = path.join(this.mount, 'legacy', name);
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(source, destination, { recursive: true, preserveTimestamps: true });
        const isDir = (await stat(source)).isDirectory();
        const same = isDir ? await fingerprint(source) === await fingerprint(destination) : (await readFile(source)).equals(await readFile(destination));
        if (!same) throw new VaultError('migration', 'Legacy recovery verification failed.');
        if (name === 'environment') await cp(source, path.join(this.mount, 'synapse.env'));
      }
    }
    if (!m.cleanupComplete && !m.backupReady) {
      await runPrivate('/bin/sync', []);
      await this.seal();
      await this.copyBackup();
      m.backupReady = true; m.backupAt = new Date().toISOString(); await this.save(m);
      await this.attach(secret);
    }
    // The marker is durable before cleanup; interruption resumes cleanup on the next authenticated unlock.
    if (!m.cleanupComplete) {
      if (await exists(original)) {
        if (!m.sourceHash || m.sourceHash !== await fingerprint(path.join(this.mount, 'migration-recovery'))) throw new VaultError('migration', 'Verified recovery copy is required before cleanup.');
        // Plaintext changed after it was copied: it is set aside, never deleted unseen.
        if (await fingerprint(original) !== m.sourceHash) await rename(original, path.join(this.data, `vault-changed-after-migration-${Date.now()}`));
        else await rm(original, { recursive: true });
      }
      for (const source of [path.join(this.data, 'shell'), path.join(this.data, 'synapse.env'), this.legacyLogs ?? path.join(this.data, 'logs')]) {
        if (await exists(source)) await rm(source, { recursive: true });
      }
      m.cleanupComplete = true; await this.save(m);
    }
  }

  /**
   * Copies the (unmounted) image beside it and verifies the copy; the previous backup is replaced only once the new
   * one is verified, so a failed refresh never leaves no backup at all.
   */
  private async copyBackup(): Promise<void> {
    const next = `${this.backup}.new`;
    await rm(next, { recursive: true, force: true });
    await cp(this.image, next, { recursive: true, preserveTimestamps: true });
    if (await fingerprint(this.image) !== await fingerprint(next)) { await rm(next, { recursive: true, force: true }); throw new VaultError('storage', 'Encrypted backup verification failed; the previous backup is kept.'); }
    const old = `${this.backup}.old`;
    await rm(old, { recursive: true, force: true });
    if (await exists(this.backup)) await rename(this.backup, old);
    await rename(next, this.backup);
    await rm(old, { recursive: true, force: true });
    await this.writeJson(this.backupKey, await this.metadata());
    await runPrivate('/bin/sync', []);
  }

  /** Refreshes the encrypted backup when it is older than `days` (called on quit, with the volume closed). */
  async refreshBackup(days = 7): Promise<boolean> {
    if (!await this.configured() || await this.mounted() || !await exists(this.image)) return false;
    const m = await this.metadata();
    if (!m.backupReady || !m.cleanupComplete) return false;
    const last = m.backupAt ? Date.parse(m.backupAt) : 0;
    if (Date.now() - last < days * 86_400_000) return false;
    await this.copyBackup();
    m.backupAt = new Date().toISOString();
    await this.save(m);
    return true;
  }

  async enroll(password: string): Promise<void> {
    const m = await this.metadata();
    const secret = await unwrapKey(m.password, password);
    try {
      const wrapped = await this.biometrics.wrap(secret);
      const proof = await this.biometrics.unwrap(wrapped);
      try { if (!proof.equals(secret)) throw new VaultError('touch-id', 'Biometric verification failed.'); } finally { proof.fill(0); }
      m.biometric = wrapped.toString('base64'); await this.save(m);
    } finally { secret.fill(0); }
  }
}

import { SandboxPrerequisiteError } from '../../modules/sandboxes/connector.js';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, readdir, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCommandTunnel } from './command-tunnel.js';

/** SIGKILL cannot run finally. Reap only same-user directories whose owner PID is gone. */
export async function reapInstaboxSSHDirectories(root = tmpdir()) {
  let removed = 0;
  for (const name of await readdir(root)) {
    const match = /^hexagon-instabox-([1-9][0-9]*)-[A-Za-z0-9]{6}$/.exec(name);
    if (!match) continue;
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid) || pid === process.pid) continue;
    const directory = join(root, name);
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid())) continue;
      try { process.kill(pid, 0); continue; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') continue; }
      await rm(directory, { recursive: true, force: true }); removed++;
    } catch { /* Concurrent release or inaccessible directories are not ours to force. */ }
  }
  return removed;
}
let sweep: Promise<unknown> | undefined;
let sweptAt = 0;
async function sweepOrphanedKeys() {
  if (Date.now() - sweptAt < 60000) return;
  if (!sweep) sweep = reapInstaboxSSHDirectories().then(() => { sweptAt = Date.now(); }).finally(() => { sweep = undefined; });
  await sweep;
}

/** Check the actual worker environment before allocating cloud resources. */
export async function checkInstaboxOpenSSH() {
  let dir: string | undefined;
  try {
    await sweepOrphanedKeys();
    const version = await promisify(execFile)('ssh', ['-V'], { timeout: 10000 });
    if (!`${version.stdout}${version.stderr}`.includes('OpenSSH_')) throw new Error('unsupported');
    dir = await mkdtemp(join(tmpdir(), `hexagon-instabox-${process.pid}-`));
    await promisify(execFile)('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'key')], { timeout: 10000 });
  } catch { throw new SandboxPrerequisiteError(); }
  finally { if (dir) await rm(dir, { recursive: true, force: true }); }
}

/** HTTPS-authenticated host CA pins SSH. No public ports or provider keys enter the guest. */
export function validateInstaboxCertificate(value: any, machine: string) {
  if (value?.machineId !== machine || value.transport !== 'ssh' || value.username !== machine ||
      !['api.instabox.sh','ssh.instabox.sh'].includes(value.host) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535 ||
      value.hostTrust?.type !== 'ca' || !Array.isArray(value.hostTrust.principals) || !value.hostTrust.principals.includes(value.host) ||
      !/^ssh-ed25519 [A-Za-z0-9+/=]+(?: [^\r\n]*)?$/.test(value.hostTrust.publicKey) ||
      !/^ssh-ed25519-cert-v01@openssh.com [A-Za-z0-9+/=]+(?: [^\r\n]*)?$/.test(value.certificate) ||
      !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) throw new Error('instabox_invalid_ssh_certificate');
  return value as { host:string; port:number; username:string; certificate:string; hostTrust:{publicKey:string} };
}
export async function openInstaboxTunnel(machine: string, port: number, issue: (publicKey: string) => Promise<unknown>) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_preview_port');
  await sweepOrphanedKeys();
  const dir = await mkdtemp(join(tmpdir(), `hexagon-instabox-${process.pid}-`));
  try {
    const key = join(dir, 'key'), known = join(dir, 'known_hosts');
    await promisify(execFile)('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { timeout: 10000 });
    const cert = validateInstaboxCertificate(await issue((await readFile(key + '.pub', 'utf8')).trim()), machine);
    await writeFile(key + '-cert.pub', cert.certificate + '\n', { mode: 0o600 });
    await writeFile(known, `@cert-authority [${cert.host}]:${cert.port},${cert.host} ${cert.hostTrust.publicKey}\n`, { mode: 0o600 });
    const target = await openCommandTunnel(async () => { const child = spawn('ssh', ['-F', '/dev/null', '-T', '-i', key,
      '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'IdentityAgent=none', '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${known}`, '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=15',
      '-o', 'ServerAliveInterval=10', '-o', 'ServerAliveCountMax=2', '-p', String(cert.port),
      '-W', `127.0.0.1:${port}`, `${cert.username}@${cert.host}`], { stdio: ['pipe', 'pipe', 'pipe'] });
      return { stdin:child.stdin, stdout:child.stdout, stderr:child.stderr, on:child.on.bind(child), kill:()=>child.kill('SIGTERM') };
    });
    return { ...target, release: () => { target.release?.(); void rm(dir, { recursive: true, force: true }); } };
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}

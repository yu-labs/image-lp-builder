#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';

function argValue(name) {
  const eq = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index !== -1) return process.argv[index + 1];
  return undefined;
}

function devPort() {
  return argValue('--port') ?? argValue('-p') ?? process.env.PORT ?? '4321';
}

function stripPortArgs(args) {
  const stripped = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      i++;
      continue;
    }
    if (arg.startsWith('--port=')) continue;
    stripped.push(arg);
  }
  return stripped;
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickPort(start) {
  for (let port = start; port < start + 50; port++) {
    if (await portAvailable(port)) return port;
  }
  throw new Error(`No available port found from ${start} to ${start + 49}`);
}

function isPrivateIPv4(address) {
  return (
    address.startsWith('10.') ||
    address.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function lanIPv4s() {
  return Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter(
      (item) =>
        item.family === 'IPv4' && !item.internal && isPrivateIPv4(item.address)
    )
    .map((item) => item.address);
}

const requestedPort = Number.parseInt(devPort(), 10);
if (!Number.isInteger(requestedPort) || requestedPort <= 0) {
  throw new Error(`Invalid dev port: ${devPort()}`);
}
const port = await pickPort(requestedPort);
const ips = lanIPv4s();
const extraArgs =
  process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2);
const astroExtraArgs = stripPortArgs(extraArgs);
const hasHostArg = extraArgs.some(
  (arg) => arg === '--host' || arg.startsWith('--host=')
);
const astroArgs = ['exec', 'astro', 'dev'];
if (!hasHostArg) astroArgs.push('--host', '0.0.0.0');
astroArgs.push('--port', String(port), ...astroExtraArgs);

console.log('');
console.log('image-lp-builder dev');
console.log(`  Local admin:  http://localhost:${port}/admin`);
if (ips.length > 0) {
  console.log(`  Mobile admin: http://${ips[0]}:${port}/admin`);
  for (const ip of ips.slice(1)) {
    console.log(`                http://${ip}:${port}/admin`);
  }
} else {
  console.log('  Mobile admin: no LAN IPv4 address found');
}
console.log('');

const child = spawn('pnpm', astroArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

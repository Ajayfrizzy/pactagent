let shuttingDown = false;

export function isShuttingDown() {
  return shuttingDown;
}

export function beginShutdown() {
  shuttingDown = true;
}

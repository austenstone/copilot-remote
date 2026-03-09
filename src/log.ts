// Copilot Remote — Debug Logger
let debugEnabled = process.env.COPILOT_REMOTE_DEBUG === '1';

const ts = () => {
  const d = new Date();
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
};

export const log = {
  info: (...args: unknown[]) => console.log(ts(), ...args),
  error: (...args: unknown[]) => console.error(ts(), '[ERROR]', ...args),
  debug: (...args: unknown[]) => {
    if (debugEnabled) console.log(ts(), '[DEBUG]', ...args);
  },
  setDebug: (on: boolean) => { debugEnabled = on; },
  isDebug: () => debugEnabled,
};

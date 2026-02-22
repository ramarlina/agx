import '@testing-library/jest-dom';

if (typeof global.setImmediate === 'undefined') {
  global.setImmediate = ((callback: (...args: any[]) => void, ...args: any[]) =>
    setTimeout(callback, 0, ...args)) as typeof setImmediate;
}

if (typeof global.clearImmediate === 'undefined') {
  global.clearImmediate = ((id: NodeJS.Immediate | number) =>
    clearTimeout(id as unknown as NodeJS.Timeout)) as typeof clearImmediate;
}

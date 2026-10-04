export function createSingleFlight() {
  const inFlight = new Map();
  return function run(key, task) {
    const current = inFlight.get(key);
    if (current) return current;
    const request = Promise.resolve().then(task).finally(() => {
      if (inFlight.get(key) === request) inFlight.delete(key);
    });
    inFlight.set(key, request);
    return request;
  };
}

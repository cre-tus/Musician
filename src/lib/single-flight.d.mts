export function createSingleFlight(): <T>(key: string, task: () => Promise<T> | T) => Promise<T>;

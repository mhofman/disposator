/** @type {Omit<IterableIterator<any>, 'next' | 'return' | 'throw'>} */
export const IteratorPrototype = Object.getPrototypeOf(
  Object.getPrototypeOf([][Symbol.iterator]())
);

/** @type {Omit<AsyncIterableIterator<any>, 'next' | 'return' | 'throw'>} */
export const AsyncIteratorPrototype = Object.getPrototypeOf(
  Object.getPrototypeOf(async function* () {}).prototype
);

/**
 * @template T
 * @template {Pick<IterableIterator<T>, 'next' | 'return' | 'throw'>} Iter
 * @param {Partial<{[key: PropertyKey]: any}> & Pick<Iter, 'next' | 'return' | 'throw'>} iter
 * @returns {Iter}
 */
export const createIterator = (iter) =>
  Object.assign(Object.create(IteratorPrototype), iter);

/**
 * @template T
 * @template {Pick<AsyncIterableIterator<T>, 'next' | 'return' | 'throw'>} Iter
 * @param {Partial<{[key: PropertyKey]: any}> & Pick<Iter, 'next' | 'return' | 'throw'>} iter
 * @returns {Iter}
 */
export const createAsyncIterator = (iter) =>
  Object.assign(Object.create(AsyncIteratorPrototype), iter);

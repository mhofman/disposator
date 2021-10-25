export declare const symbolDispose: unique symbol;

export declare const symbolAsyncDispose: unique symbol;

export declare class Disposable {
  /**
   * Creates a disposable object aggregating multiple disposable resources
   *
   * @param disposables An iterable containing resources to be disposed of
   * when the returned object is itself disposed of
   */
  static from(disposables: Iterable<Disposable.IterValue>): Disposable;

  /**
   * Creates a disposable object aggregating multiple disposable resources
   *
   * @param values An iterable containing values for which the mapped
   * resource will be disposed of when the returned object is itself disposed of
   * @param mapFn A function returning a disposable resource from the
   * iterated value
   */
  static from<T>(
    values: Iterable<T>,
    mapFn: (value: T) => Disposable.IterValue
  ): Disposable;

  /**
   * Wraps an iterable to ensure that iterated resources are disposed of
   *
   * @param disposables An iterable containing disposable resources over
   * which to iterate then dispose
   */
  static usingFrom<T extends Disposable.IterValue>(
    disposables: Iterable<T>
  ): Iterable<T>;

  /**
   * Wraps an iterable to ensure that iterated resources are disposed of
   *
   * @param values An iterable containing values over which to iterate
   * @param mapFn A function returning a disposable resource from the
   * iterated value
   */
  static usingFrom<T>(
    values: Iterable<T>,
    mapFn: (value: T) => Disposable.IterValue
  ): Iterable<T>;

  /**
   * Returns a "using" iterator which yields a single helper to register
   * disposable resources to be disposed of when the iterator is closed. Use
   * with a `for-of` statement to perform RAII style explicit resource
   * management
   */
  static [Symbol.iterator](): Disposable.UsingIterator;

  /**
   * Creates a disposable object from a simple callback
   *
   * @param onDispose A callback to execute when this object is disposed of
   */
  constructor(onDispose: () => void);

  /**
   * Disposes resources within this object
   */
  [symbolDispose](): void;
}

export declare namespace Disposable {
  export type IterValue = Disposable;

  export interface Using {
    /**
     * Add a disposable resource for tracking in the current iterator
     *
     * @param disposable The disposable resource to track
     * @returns The disposable resource
     */
    <T extends IterValue>(disposable: T): T;

    /**
     * Add a disposable resource for tracking in the current iterator
     *
     * @param value The value to map a disposable resource from
     * @param mapFn A function returning a disposable resource from the value
     * @returns The value
     */
    <T>(value: T, mapFn: (value: T) => IterValue): T;
  }

  export type UsingIterator = Iterator<Using, void, void>;
}

export declare class AsyncDisposable {
  /**
   * Creates an async disposable object aggregating multiple disposable or
   * async disposable resources
   *
   * @param disposables An iterable or async iterable containing resources to
   * be disposed of when the returned object is itself disposed of
   */
  static from(
    disposables:
      | Iterable<AsyncDisposable.IterValue>
      | AsyncIterable<AsyncDisposable.IterValue>
  ): Promise<AsyncDisposable>;

  /**
   * Creates an async disposable object aggregating multiple disposable or
   * async disposable resources
   *
   * @param values An iterable or async iterable containing values for which
   * the mapped resource will be disposed of when the returned object is itself
   * disposed of
   * @param mapFn A function returning a disposable or async disposable
   * resource from the iterated value
   */
  static from<T>(
    values: Iterable<T> | AsyncIterable<T>,
    mapFn: (value: T) => AsyncDisposable.IterValue
  ): Promise<AsyncDisposable>;

  /**
   * Wraps an iterable or async iterable to ensure that iterated resources are
   * disposed of
   *
   * @param disposables An iterable or async iterable containing disposable
   * or async disposable resources over which to iterate then dispose
   */
  static usingFrom<T extends AsyncDisposable.IterValue>(
    disposables: Iterable<T> | AsyncIterable<T>
  ): AsyncIterable<T>;

  /**
   * Wraps an iterable or async iterable to ensure that iterated resources are
   * disposed of
   *
   * @param values An iterable or async iterable containing values over which
   * to iterate
   * @param mapFn A function returning a disposable or async disposable from
   * the iterated value
   */
  static usingFrom<T>(
    values: Iterable<T> | AsyncIterable<T>,
    mapFn: (value: T) => AsyncDisposable.IterValue
  ): AsyncIterable<T>;

  /**
   * Returns a "using" async iterator which yields a single helper to register
   * disposable or async disposable resources to be disposed of when the
   * iterator is closed. Use with a `for-await-of` statement to perform RAII
   * style explicit resource management.
   */
  static [Symbol.asyncIterator](): AsyncDisposable.UsingAsyncIterator;

  /**
   * Creates an async disposable object from a simple async callback
   *
   * @param onDispose An async callback to execute when this object is
   * disposed of
   */
  constructor(onDispose: () => void | PromiseLike<void>);

  /**
   * Disposes resources within this object
   */
  [symbolAsyncDispose](): Promise<void>;
}

export declare namespace AsyncDisposable {
  export type IterValue = Disposable | AsyncDisposable;

  export interface Using {
    /**
     * Add a disposable or async disposable resource for tracking in the
     * current async iterator
     *
     * @param disposable The disposable or async disposable resource to track
     * @returns The disposable or async disposable resource
     */
    <T extends IterValue>(disposable: T): T;

    /**
     * Add a disposable or async disposable resource for tracking in the
     * current async iterator
     *
     * @param value The value to map a disposable or async disposable resource from
     * @param mapFn A function returning a disposable or async disposable resource
     * from the value
     * @returns The value
     */
    <T>(value: T, mapFn: (value: T) => IterValue): T;
  }

  export type UsingAsyncIterator = AsyncIterator<Using, void, void>;
}

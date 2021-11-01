import { symbolDispose, symbolAsyncDispose } from "./symbols.js";
import { Disposable } from "./disposable.js";

export interface AsyncDisposable {
  /**
   * Disposes resources within this object
   */
  [symbolAsyncDispose](): Promise<void>;
}

declare namespace AsyncDisposable {
  /**
   * An async disposable object aggregating multiple resources
   *
   * When the object is disposed of, the aggregated resources are disposed of
   * in reverse order to which they were added for tracking.
   */
  export interface Aggregate extends AsyncDisposable {
    /**
     * Helper adding new resources to track in the aggregated async disposable.
     * The helper can be detached
     */
    readonly using: Using;
  }

  export interface Constructor {
    /**
     * Creates an async disposable object aggregating the given disposable or
     * async disposable resources
     *
     * @param disposables An iterable or async iterable containing resources to
     * be disposed of when the returned object is itself disposed of
     */
    from(
      disposables: Iterable<Resource> | AsyncIterable<Resource>
    ): Promise<Aggregate>;

    /**
     * Creates an async disposable object aggregating the given disposable or
     * async disposable resources
     *
     * @param values An iterable or async iterable containing values for which
     * the mapped resource will be disposed of when the returned object is itself
     * disposed of
     * @param mapFn A function returning a disposable or async disposable
     * resource from the iterated value
     */
    from<T>(
      values: Iterable<T> | AsyncIterable<T>,
      mapFn: (value: T) => Resource<T>
    ): Promise<Aggregate>;

    /**
     * Creates an aggregate async disposable object
     *
     * Note: Prefer AsyncDisposable.from()
     * Any error adding the initial tracked resources may result in an unhandled
     * rejection resulting from the automatic disposal of the added resources
     *
     * @param args Initial resources to add for tracking
     */
    new (...args: Resource[]): Aggregate;

    /**
     * Wraps an iterable or async iterable to ensure that iterated resources are
     * disposed of
     *
     * @param disposables An iterable or async iterable containing disposable
     * or async disposable resources over which to iterate then dispose
     */
    usingFrom<T extends Resource>(
      disposables: Iterable<T> | AsyncIterable<T>
    ): AsyncIterable<T>;

    /**
     * Wraps an iterable or async iterable to ensure that iterated resources are
     * disposed of
     *
     * @param values An iterable or async iterable containing values over which
     * to iterate
     * @param mapFn A function returning a disposable or async disposable
     * resource from the iterated value
     */
    usingFrom<T>(
      values: Iterable<T> | AsyncIterable<T>,
      mapFn: (value: T) => Resource<T>
    ): AsyncIterable<T>;

    /**
     * Returns an async iterator which yields the provided async disposable
     * resource, and disposes of the resource at close. Use with a
     * `for-await-of` statement to ensure the iterator is closed and the
     * resource disposed of after usage.
     *
     * @param disposable The disposable resource to track
     */
    using<T extends Resource>(disposable: T): UsingIterator<T>;

    /**
     * Returns an async iterator which yields the provided resource, and
     * disposes of the resource with the specified async dispose callback at
     * close. Use with a `for-await-of` statement to ensure the iterator is
     * closed and the resource disposed of after usage.
     *
     * @param value A value to consider as a resource to dispose
     * @param onDispose The async dispose callback invoked with the value
     * as `this` context
     */
    using<T>(value: T, onDispose: OnDispose<T>): UsingIterator<T>;

    /**
     * Returns an async iterator which yields a new async aggregate instance.
     * Its `using` helper can be used to track disposable or async disposable
     * resources which will be disposed of when the iterator is closed. Use
     * with a `for-await-of` statement to perform RAII style explicit resource
     * management
     */
    [Symbol.asyncIterator](): UsingIterator<Aggregate>;
  }

  export interface Using {
    /**
     * Add a disposable or async disposable resource for tracking
     *
     * @param disposable The disposable or async disposable resource to track
     * @returns The disposable or async disposable resource
     */
    <T extends Resource>(disposable: T): T;

    /**
     * Add a disposable or async disposable resource for tracking
     *
     * @param value A value to consider as a resource to dispose
     * @param onDispose The async dispose callback invoked with the value
     *  as `this` context
     * @returns The value
     */
    <T>(value: T, onDispose: OnDispose<T>): T;
  }

  export type OnDispose<T = void> = (this: T) => void | PromiseLike<void>;

  export type Resource<T = void> = Disposable | AsyncDisposable | OnDispose<T>;

  export type UsingIterator<T> = AsyncIterableIterator<T>;
}

export declare const AsyncDisposable: AsyncDisposable.Constructor;

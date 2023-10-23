import { Observable } from "rxjs"
import { Proxied, Target } from "./processing"
import { ObservableAndPromise } from "./util"

/**
 * The frontend object that translates calls to messages and sends them over a connection.
 */
export interface Sender {

    /**
     * Call a command on the remote.
     * @param command Command name.
     * @param data Arguments in an array.
     */
    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown>

    /**
     * An observable that notifies when this sender is connected or reconnected to a new worker.
     */
    connected(): Observable<void>

    /**
     * An observable that notifies when this sender is connected or reconnected to a new worker.
     */
    withOptions(options: SenderOptions): Sender

    /**
     * Close this sender and disconnect from the remote.
     */
    close(): void

}

export interface SenderOptions {

    /**
     * Automatically retry promise calls if the worker disappears.
     */
    readonly autoRetryPromises?: boolean | undefined

    /**
     * Automatically retry observable calls if the worker disappears.
     */
    readonly autoRetryObservables?: boolean | undefined

}

/**
 * Proxy a wrapper as an object type.
 * @param sender Sender.
 * @returns A proxy object.
 */
export function proxy<T extends Target>(sender: Sender) {
    const proxy = new Proxy(sender, {
        get(target, key) {
            return (...args: unknown[]) => target.call(key as any, ...args as any)
        }
    })
    return proxy as Proxied<T>
}

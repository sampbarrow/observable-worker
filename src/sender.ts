import { Observable } from "rxjs"
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
     * Watch this for individual senders when a new connection is made.
     */
    watch(autoReconnect?: boolean | undefined): Observable<Sender>

    /**
     * An observable that notifies when this sender is connected or reconnected to a new worker.
     */
    withOptions(options: CallOptions): Sender

    /**
     * Close this sender and disconnect from the remote.
     */
    close(): void

}

export interface CallOptions {

    /**
     * The amount of time to wait for a worker to become available.
     */
    readonly connectionTimeout?: number | undefined

    /**
     * Timeout for promises.
     */
    readonly promiseTimeout?: number | undefined

    /**
     * Automatically retry promise calls if the worker disappears.
     */
    readonly autoRetryPromises?: boolean | undefined

    /**
     * Automatically retry observable calls if the worker disappears.
     */
    readonly autoRetryObservables?: boolean | undefined

}

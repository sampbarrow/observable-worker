import { Observable } from "rxjs"
import { Sender } from "./processing"

export interface VolatileSender extends Sender {

    /**
     * Watch this for individual senders when a new connection is made.
     */
    watch(autoReconnect?: boolean | undefined): Observable<Sender>

}

export interface CallOptions {

    readonly generateId?: (() => string) | undefined

    /**
     * The amount of time to wait for a worker to become available.
     * @deprecated
     */
    readonly connectionTimeout?: number | undefined

    /**
     * The amount of time to wait for a worker to become available.
     * @deprecated
     */
    readonly acknowledgementTimeout?: number | undefined

    /**
     * Timeout for promises.
     * @deprecated
     */
    readonly promiseTimeout?: number | undefined

    /**
     * Automatically retry promise calls if the worker disappears.
     * @deprecated
     */
    readonly autoRetryPromises?: boolean | undefined

    /**
     * Automatically retry observable calls if the worker disappears.
     * @deprecated
     */
    readonly autoRetryObservables?: boolean | undefined

}

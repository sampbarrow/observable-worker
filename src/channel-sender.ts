import PLazy from "p-lazy"
import { BehaviorSubject, Observable, ObservableNotification, OperatorFunction, ReplaySubject, dematerialize, filter, finalize, firstValueFrom, map, share, switchMap, throwError, timeout } from "rxjs"
import { Channel, VolatileChannel } from "./channel"
import { Answer, Call, ID } from "./processing"
import { CallOptions, Sender } from "./sender"
import { ObservableAndPromise, RemoteError, generateId } from "./util"

const DEFAULT_CONNECTION_TIMEOUT = 1000//TODO raise

export interface ChannelSenderOptions extends CallOptions {

    readonly channel: VolatileChannel<ObservableNotification<Answer>, Call>
    readonly connectionTimeout?: number

}

export class ChannelSender implements Sender {

    private readonly closed
    private readonly channel

    constructor(private readonly config: ChannelSenderOptions) {
        this.closed = new BehaviorSubject<boolean>(false)
        /* this.channel = config.channel.pipe(
             share({
                 connector: () => new ReplaySubject(1),
                 resetOnRefCountZero: false,
                 resetOnComplete: false,
                 resetOnError: true,
             })
         )*/
        this.channel = this.closed.pipe(
            switchMap(closed => {
                console.log("TODO closed", closed)
                if (closed) {
                    return throwError(() => new Error("This remote is closed."))
                }
                return config.channel
            }),
            share({
                connector: () => new ReplaySubject(1),
                resetOnRefCountZero: false,
                resetOnComplete: false,
                resetOnError: true,
            })
        )
    }

    connected() {
        return this.current(true).pipe(map(() => void 0))
    }
    close() {
        //TODO can we complete closed?
        this.closed.next(true)
    }
    withOptions(options: CallOptions) {
        return new ChannelSender({ ...this.config, channel: this.channel, ...options })
    }

    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown> {
        const observable = this.current(this.config.autoRetryObservables ?? true).pipe(
            switchMap(connection => {
                const id = generateId()
                connection.next({
                    kind: "S",
                    id,
                    command,
                    data
                })
                return connection.pipe(
                    finalize(() => {
                        //TODO how do we make it so this only issues if the inner observable is unsubscribed from directly?
                        //if the channel closes, this fails - its not necessary in that case
                        connection.next({
                            kind: "U",
                            id
                        })
                    }),
                    dematerialize(),
                    answer(id, this.config.observableTimeout),
                )
            }),
            share()
        )
        const promise = PLazy.from(async () => {
            return firstValueFrom(this.current(this.config.autoRetryPromises ?? false).pipe(
                switchMap(connection => {
                    const id = generateId()
                    const observable = connection.pipe(dematerialize(), answer(id, this.config.promiseTimeout))
                    connection.next({
                        kind: "X",
                        id,
                        command,
                        data
                    })
                    return observable
                })
            ))
        })
        return new ObservableAndPromise(observable, promise)
    }

    private current(autoRetry: boolean) {
        return Channel.volatile(this.channel, autoRetry, this.config.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT)
    }

}

function answer(id: ID, timeoutMs?: number | undefined) {
    return (observable: Observable<Answer>) => {
        return observable.pipe(
            filter(response => response.id === id),
            dematerialize(),
            optional((() => {
                if (timeoutMs !== undefined) {
                    const timeoutMessage = "The remote call has timed out after " + timeoutMs.toLocaleString() + "ms."
                    return timeout({
                        first: timeoutMs,
                        with: () => {
                            return throwError(() => new RemoteError("timeout", timeoutMessage))
                        }
                    })
                }
            })())
        )
    }
}
function optional<I, O>(options?: OperatorFunction<I, O> | undefined) {
    return (observable: Observable<I>) => {
        if (options !== undefined) {
            return observable.pipe(options)
        }
        return observable
    }
}

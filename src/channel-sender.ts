import PLazy from "p-lazy"
import { BehaviorSubject, Observable, ObservableNotification, ReplaySubject, dematerialize, filter, finalize, firstValueFrom, map, of, share, switchMap, throwError, timeout } from "rxjs"
import { Channel, VolatileChannel } from "./channel"
import { optional } from "./operators"
import { Answer, Call, ID } from "./processing"
import { VolatileCallOptions, VolatileSender } from "./sender"
import { ObservableAndPromise, RemoteError, generateId } from "./util"

const DEFAULT_CONNECTION_TIMEOUT = 10000 //TODO why do we hit this when its syncing? should not be that backed up

/*
export interface ChannelSenderOptions {

    readonly channel: Channel<ObservableNotification<Answer>, Call>
    readonly promiseTimeout?: number

}
export class ADumbSender implements Sender {

    constructor(private readonly config: ChannelSenderOptions) {

    }

    close() {
        //TODO important 
    }
    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown> {
        const observable = defer(() => {
            const id = generateId()
            this.config.connection.next({
                kind: "S",
                id,
                command,
                data
            })
            return this.config.connection.pipe(
                finalize(() => {
                    //TODO how do we make it so this only issues if the inner observable is unsubscribed from directly?
                    //if the channel closes, this fails - its not necessary in that case
                    this.config.connection.next({
                        kind: "U",
                        id
                    })
                }),
                dematerialize(),
                answer(id),
            )
        }).pipe(
            share()
        )
        const promise = PLazy.from(async () => {
            const id = generateId()
            const observable = this.config.connection.pipe(dematerialize(), answer(id, this.config.promiseTimeout))
            this.config.connection.next({
                kind: "X",
                id,
                command,
                data
            })
            return observable
        })
        return new ObservableAndPromise(observable, promise)
    }

}
*/

export interface VolatileChannelSenderOptions extends VolatileCallOptions {

    readonly channel: VolatileChannel<ObservableNotification<Answer>, Call>

}

export class VolatileChannelSender implements VolatileSender {

    private readonly closed
    private readonly channel

    constructor(private readonly config: VolatileChannelSenderOptions) {
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

    watch() {
        return this.current(true).pipe(map(connection => new VolatileChannelSender({ ...this.config, channel: of(connection) })))
    }
    close() {
        //TODO can we complete closed?
        this.closed.next(true)
    }
    withOptions(options: VolatileCallOptions) {
        return new VolatileChannelSender({ ...this.config, ...options, channel: this.channel })
    }

    /*
    observe(autoRetry: boolean, command: string, ...data: readonly unknown[]): Output<unknown> {
        return this.current(autoRetry).pipe(
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
    }
    execute(command: string, ...data: readonly unknown[]): Promise<unknown> {
        return firstValueFrom(this.executeRetry(command, ...data))
    }
    executeRetry(command: string, ...data: readonly unknown[]): Observable<unknown> {
        return this.current(true).pipe(
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
        )
    }*/

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
                    answer(id, command, this.config.observableTimeout),
                )
            }),
            share()
        )
        const promise = PLazy.from(async () => {
            return firstValueFrom(this.current(this.config.autoRetryPromises ?? false).pipe(
                switchMap(connection => {
                    const id = generateId()
                    const observable = connection.pipe(dematerialize(), answer(id, command, this.config.promiseTimeout))
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

function answer(id: ID, command: string, timeoutMs?: number | undefined) {
    return (observable: Observable<Answer>) => {
        return observable.pipe(
            filter(response => response.id === id),
            dematerialize(),
            optional((() => {
                if (timeoutMs !== undefined) {
                    const timeoutMessage = "The remote call to \"" + command + "\" has timed out after " + timeoutMs.toLocaleString() + "ms."
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

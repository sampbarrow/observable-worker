import PLazy from "p-lazy"
import { BehaviorSubject, Observable, ObservableNotification, ReplaySubject, dematerialize, filter, finalize, firstValueFrom, map, of, share, switchMap, throwError, timeout } from "rxjs"
import { ChannelFactory, withVolatility } from "./channel"
import { optional } from "./operators"
import { Answer, Call, ID } from "./processing"
import { CallOptions, Sender } from "./sender"
import { ObservableAndPromise, RemoteError, generateId } from "./util"

/*
export interface ChannelSenderOptions extends CallOptions {

    readonly channel: Channel<ObservableNotification<Answer>, Call>

}

export class ChannelSender implements Sender {

    private readonly subscription
    private readonly channel = new ReplaySubject<Connection<ObservableNotification<Answer>, Call>>

    constructor(private readonly config: ChannelSenderOptions) {
        this.subscription = config.channel.subscribe(this.channel)
        /*
        this.channel = config.channel.pipe(
            share({
                connector: () => new ReplaySubject(1),
                resetOnRefCountZero: false,
                resetOnComplete: false,
                resetOnError: true,
            })
        )
    }

    close() {
        this.subscription.unsubscribe()
        this.channel.complete()
    }

}
*/

export interface VolatileChannelSenderOptions extends CallOptions {

    readonly channel: ChannelFactory<ObservableNotification<Answer>, Call>

}

export class VolatileChannelSender implements Sender {

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

    watch(autoReconnect = true) {
        return this.channel.pipe(
            withVolatility(autoReconnect, this.config.connectionTimeout),
            map(channel => {
                return new VolatileChannelSender({ ...this.config, channel: of(channel) })
            })
        )
    }
    close() {
        //TODO complete
        this.closed.next(true)
    }
    withOptions(options: CallOptions) {
        return new VolatileChannelSender({ ...this.config, ...options, channel: this.channel })
    }

    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown> {
        const observable = this.channel.pipe(
            withVolatility(this.config.autoRetryObservables ?? true, this.config.connectionTimeout),
            switchMap(_ => _),
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
                    answer(id, command),
                )
            })
        )
        const promise = PLazy.from(async () => {
            return await firstValueFrom(this.channel.pipe(
                withVolatility(this.config.autoRetryPromises ?? false, this.config.connectionTimeout),
                switchMap(_ => _),
                switchMap(connection => {
                    const id = generateId()
                    connection.next({
                        kind: "X",
                        id,
                        command,
                        data
                    })
                    return connection.pipe(dematerialize(), answer(id, command, this.config.promiseTimeout))
                })
            ))
        })
        return new ObservableAndPromise(observable, promise)
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

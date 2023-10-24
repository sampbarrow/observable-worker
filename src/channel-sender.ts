import PLazy from "p-lazy"
import { ReplaySubject, Subject, dematerialize, filter, finalize, firstValueFrom, map, share, switchMap, timeout } from "rxjs"
import { Channel, VolatileChannel } from "./channel"
import { Answer, Call } from "./processing"
import { RetryOptions, Sender } from "./sender"
import { ObservableAndPromise, generateId } from "./util"

const DEFAULT_CONNECTION_TIMEOUT = 3000

export interface ChannelSenderOptions extends RetryOptions {

    readonly channel: VolatileChannel<Answer, Call>
    readonly connectionTimeout?: number

}

export class ChannelSender implements Sender {

    private readonly closeNotifier = new Subject<void>()
    private readonly channel
    //   private readonly connection

    constructor(private readonly config: ChannelSenderOptions) {
        //TODO how to close this permanently?
        this.channel = config.channel.pipe(
            share({
                connector: () => new ReplaySubject(1),//TODO when we do this, it works, but then it fails to reconnect if there is an error
                resetOnRefCountZero: () => this.closeNotifier,
                //  resetOnComplete: false,
                resetOnError: true,
            })
        )
    }

    connected() {
        return this.current(true).pipe(map(() => void 0))
    }
    close() {
        // this.connection.unsubscribe()
        this.closeNotifier.next()
        this.closeNotifier.complete()
    }
    withOptions(options: RetryOptions) {
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
                    filter(response => response.id === id),
                    finalize(() => {
                        //TODO how do we make it so this only issues if the inner observable is unsubscribed from directly?
                        //if the channel closes, this fails
                        connection.next({
                            kind: "U",
                            id
                        })
                    }),
                    dematerialize(),
                )
            }),
            share()
        )
        const promise = PLazy.from(async () => {
            return firstValueFrom(this.current(this.config.autoRetryPromises ?? false).pipe(
                switchMap(connection => {
                    const id = generateId()
                    const observable = connection.pipe(
                        filter(response => response.id === id),
                        dematerialize(),
                    )
                    connection.next({
                        kind: "X",
                        id,
                        command,
                        data
                    })
                    if (this.config.promiseTimeout !== undefined) {
                        return observable.pipe(
                            timeout({
                                first: this.config.promiseTimeout
                            })
                        )
                    }
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

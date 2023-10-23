import PLazy from "p-lazy"
import { NEVER, ReplaySubject, filter, finalize, first, firstValueFrom, map, merge, mergeMap, of, share, skip, switchMap, throwError } from "rxjs"
import { Channel, Connection } from "./channel"
import { Answer, Call } from "./processing"
import { Sender, SenderOptions } from "./sender"
import { ObservableAndPromise, RemoteError, generateId } from "./util"

export interface ChannelSenderConfig extends SenderOptions {

    readonly channel: Channel<Answer, Call>
    readonly log?: boolean | undefined

}

export class ChannelSender implements Sender {

    private readonly channel

    constructor(private readonly config: ChannelSenderConfig) {
        //TODO connectable SHOULD work here but it doesnt - look at it later
        this.channel = new ReplaySubject<Connection<Answer, Call>>(1)
        config.channel.subscribe(this.channel)
    }

    connected() {
        return this.channel.pipe(map(() => void 0))
    }
    close() {
        this.channel.complete()
    }
    withOptions(options: SenderOptions) {
        return new ChannelSender({ ...this.config, channel: this.channel, ...options })
    }

    private current(retryOnInterrupt: boolean) {
        return merge(
            this.channel.pipe(first()),
            this.channel.pipe(
                skip(1),
                map(sender => {
                    if (retryOnInterrupt) {
                        return sender
                    }
                    else {
                        throw new RemoteError("worker-disappeared", "The worker was closed. Please try again.")
                    }
                })
            )
        )
    }

    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown> {
        if (this.config.log) {
            console.log("[Worker/Sender] Received command.", { command, data })
        }
        const observable = this.current(this.config.autoRetryObservables ?? true).pipe(
            switchMap(connection => {
                const id = generateId()
                if (this.config.log) {
                    console.log("[Worker/Sender] Sending an observable call.", { id, command, data })
                }
                connection.next({
                    type: "subscribe",
                    id,
                    command,
                    data
                })
                return connection.pipe(
                    filter(response => response.id === id),
                    mergeMap(response => {
                        if (this.config.log) {
                            console.log("[Worker/Sender] Received a response to an observable call.", response)
                        }
                        if (response.type === "next") {
                            return of(response.value)
                        }
                        else if (response.type === "error") {
                            return throwError(() => response.error)
                        }
                        else if (response.type === "complete") {
                            return NEVER
                        }
                        else {
                            return throwError(() => new RemoteError("invalid-message", "Received an invalid response to an observable call."))
                        }
                    }),
                    finalize(() => {
                        connection.next({
                            type: "unsubscribe",
                            id
                        })
                    }),
                )
            }),
            share()
        )
        const promise = PLazy.from(async () => {
            return firstValueFrom(this.current(this.config.autoRetryPromises ?? true).pipe(
                switchMap(connection => {
                    const id = generateId()
                    if (this.config.log) {
                        console.log("[Worker/Sender] Sending a promise call.", { id, command, data })
                    }
                    connection.next({
                        type: "execute",
                        id,
                        command,
                        data
                    })
                    return connection.pipe(
                        filter(response => response.id === id),
                        mergeMap(response => {
                            if (this.config.log) {
                                console.log("[Worker/Sender] Received a response to a promise call.", response)
                            }
                            if (response.type === "fulfilled") {
                                return of(response.value)
                            }
                            else if (response.type === "error") {
                                return throwError(() => response.error)
                            }
                            else {
                                return throwError(() => new RemoteError("invalid-message", "Received an invalid response to a promise call."))
                            }
                        })
                    )
                })
            ))
        })
        return new ObservableAndPromise(observable, promise)
    }

}

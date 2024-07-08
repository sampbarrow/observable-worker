import PLazy from "p-lazy";
import { EMPTY, Observable, ObservableNotification, Subject, concatWith, dematerialize, finalize, firstValueFrom, ignoreElements, merge, mergeMap, of, switchMap, throwError } from "rxjs";
import { Channel } from "./channel";
import { Answer, Call, ID, Sender } from "./processing";
import { CallOptions } from "./sender";
import { ObservableAndPromise, generateId } from "./util";

export interface ChannelSenderOptions extends CallOptions {

    readonly channel: Channel<ObservableNotification<Answer>, Call>

}

export class ChannelSender implements Sender {

    private readonly closed = new Subject<void>()
    private readonly channel

    constructor(private readonly config: ChannelSenderOptions) {
        this.channel = config.channel()
    }

    close() {
        this.closed.complete()
        this.channel.close?.()
    }

    call(command: string, ...data: readonly unknown[]): ObservableAndPromise<unknown> {
        const channel = merge(
            of(this.channel),
            this.closed.pipe(concatWith(throwError(() => new Error("This remote is closed.")))).pipe(ignoreElements())
        )
        const observable = channel.pipe(
            switchMap(connection => {
                const id = this.config.generateId?.() ?? generateId()
                const observable = connection.pipe(
                    finalize(() => {
                        connection.next({
                            kind: "U",
                            id
                        })
                    }),
                    dematerialize(),
                    answer(id, command),
                )
                connection.next({
                    kind: "S",
                    id,
                    command,
                    data,
                })
                return observable
            })
        )
        const promise = PLazy.from(async () => {
            return await firstValueFrom(channel.pipe(
                switchMap(connection => {
                    const id = this.config.generateId?.() ?? generateId()
                    const observable = connection.pipe(
                        dematerialize(),
                        answer(id, command),
                    )
                    connection.next({
                        kind: "X" as const,
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

}

function answer(id: ID, command: string, ackTimeout?: number | undefined) {
    return (observable: Observable<Answer>) => {
        return observable.pipe(
            mergeMap(answer => {
                if (answer.id === id) {
                    return of(answer)
                }
                return EMPTY
            }),
            dematerialize(),
        )
        /*
        return merge(
            observable.pipe(
                mergeMap(answer => {
                        if (answer.id === id) {
                            return of(answer.response)
                        }
                    return EMPTY
                }),
                dematerialize(),
            ),
            (() => {
                if (ackTimeout !== undefined) {
                    return observable.pipe(
                        mergeMap(answer => {
                            if (answer.kind === "A") {
                                if (answer.id === id) {
                                    return of(void 0)
                                }
                            }
                            return EMPTY
                        }),
                        timeout({
                            first: ackTimeout,
                            with: () => {
                                return throwError(() => new RemoteError("timeout", "The remote call to \"" + command + "\" was not acknowledged within " + ackTimeout.toLocaleString() + "ms."))
                            }
                        }),
                        ignoreElements()
                    )
                }
                else {
                    return EMPTY
                }
            })()
        )*/
    }
}

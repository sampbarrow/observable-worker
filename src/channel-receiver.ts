import { Observable, ObservableInput, ObservableNotification, catchError, combineLatest, defer, from, map, materialize, switchMap, throwError } from "rxjs"
import { Channel } from "./channel"
import { Answer, Call, Receiver, Target } from "./processing"
import { RemoteError, callOnTarget, registryWith } from "./util"

export interface ChannelReceiverConfig<T> {

    readonly target: ObservableInput<T>
    readonly channel: Channel<Call, ObservableNotification<Answer>>

}

export class ChannelReceiver<T extends Target> extends Observable<void> implements Receiver {

    constructor(private readonly config: ChannelReceiverConfig<T>) {
        super(subscriber => {
            const target = from(config.target)
            return combineLatest([
                target,
                this.config.channel,
            ]).pipe(
                switchMap(([target, connection]) => {
                    return connection.pipe(
                        map(call => {
                            if (call.kind === "U") {
                                return {
                                    action: "delete" as const,
                                    key: call.id,
                                }
                            }
                            else {
                                const observable = defer(() => {
                                    const input = callOnTarget(target, call.command, call.data)
                                    if (call.kind === "S") {
                                        if (input.observable === undefined) {
                                            throw new RemoteError("invalid-message", "Trying to treat a promise as an observable.")
                                        }
                                        else {
                                            return input.observable
                                        }
                                    }
                                    else {
                                        if (input.promise === undefined) {
                                            throw new RemoteError("invalid-message", "Trying to treat an observable as a promise.")
                                        }
                                        else {
                                            return defer(input.promise)
                                        }
                                    }
                                })
                                return {
                                    action: "add" as const,
                                    key: call.id,
                                    observable: observable.pipe(
                                        catchError(error => {
                                            return throwError(() => new RemoteError("call-failed", "Remote call to \"" + call.command + "\" failed.", { cause: error }))
                                        }),
                                        materialize()
                                    )
                                }
                            }
                        }),
                        registryWith(),
                        map(([id, answer]) => {
                            return {
                                id,
                                ...answer,
                            }
                        }),
                        materialize(),
                        map(value => {
                            connection.next(value)
                        })
                    )
                })
            ).subscribe(subscriber)
        })
    }

}

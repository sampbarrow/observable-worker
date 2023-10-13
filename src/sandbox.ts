import { EMPTY, Observable, filter, map, mergeMap, of, partition, switchMap } from "rxjs"
import { Channel } from "./channel"
import { Answer, Call } from "./processing"

export type ExclusiveMessage<I> = {
    type: "start"
} | {
    type: "started"
} | {
    type: "stop"
} | {
    type: "value"
    value: I
}

export type WrapExclusiveConfig = {

    channel: Channel<Call, Answer>

}

export function startAndStopSender<I, O>(condition: Observable<boolean>, channel: Channel<ExclusiveMessage<I>, ExclusiveMessage<O>>): Channel<I, O> {
    return condition.pipe(
        switchMap(condition => {
            if (condition) {
                return channel.pipe(
                    switchMap(connection => {
                        connection.next({ type: "start" })
                        return connection.pipe(
                            filter(_ => _.type === "started"),
                            map(() => {
                                console.log("returning a new channel")
                                return Channel.from<I, O>({
                                    observable: connection.pipe(mergeMap(_ => _.type === "value" ? of(_.value) : EMPTY)),
                                    observer: {
                                        next: value => {
                                            console.log(value)
                                            connection.next({ type: "value", value })
                                        },
                                        complete: connection.complete.bind(connection),
                                        error: connection.error.bind(connection),
                                    }
                                })
                            })
                        )
                    })
                )
            }
            else {
                return EMPTY
            }
        })
    )
}

export function startAndStopChannel<I, O>(channel: Channel<ExclusiveMessage<I>, ExclusiveMessage<O>>) {
    return channel.pipe(
        switchMap(connection => {
            const [commands, management] = partition(connection, _ => _.type === "value")
            return management.pipe(
                switchMap(message => {
                    if (message.type === "start") {
                        connection.next({
                            type: "started"
                        })
                        return of(Channel.from<I, O>({
                            observable: commands.pipe(mergeMap(_ => _.type === "value" ? of(_.value) : EMPTY)),
                            observer: {
                                next: value => {
                                    connection.next({ type: "value", value })
                                },
                                complete: connection.complete.bind(connection),
                                error: connection.error.bind(connection),
                            }
                        }))
                    }
                    else {
                        return EMPTY
                    }
                })
            )
        })
    )
}

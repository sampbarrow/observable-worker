import { EMPTY, filter, first, ignoreElements, map, merge, mergeMap, mergeWith, of, startWith, switchMap, tap } from "rxjs"
import { BatcherOptions } from "./batcher"
import { Channel } from "./channel"
import { Coordinator } from "./coordinator"
import { Answer, Call } from "./processing"
import { generateId, observeWebLock } from "./util"

export const DEFAULT_CONTEXT = "default"
export const DEFAULT_TIMEOUT = 5000

export interface BroadcastCoordinatorOptions {

    readonly context?: string
    //readonly timeout?: number

}

export function broadcastCoordinator(options: BroadcastCoordinatorOptions = {}): Coordinator {
    return {
        frontEnd: buildFrontEnd(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.dualBroadcast(id1, id2)),
        backEnd: buildBackEnd(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.dualBroadcast(id1, id2))
    }
}

export interface BroadcastCoordinatorBatchingOptions {

    readonly context?: string
    readonly batcher?: BatcherOptions
    //readonly timeout?: number

}

export function broadcastCoordinatorBatching(options: BroadcastCoordinatorBatchingOptions = {}): Coordinator {
    return {
        frontEnd: buildFrontEnd(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.batching(Channel.dualBroadcast(id1, id2), options.batcher)),
        backEnd: buildBackEnd(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.batching(Channel.dualBroadcast(id1, id2), options.batcher))
    }
}

type BroadcastChannelCreator = <I, O>(id1: string, id2: string) => Channel<I, O>

function buildFrontEnd(context: string, createBroadcastChannel: BroadcastChannelCreator) {
    return frontEndLookup(context).pipe(
        switchMap(channelId => {
            return registerWithServer(channelId).pipe(
                //TODO a better way to do this than undefined/volatilechannel?
                switchMap(channelIds => {
                    if (channelIds === undefined) {
                        return of(undefined)
                    }
                    return createBroadcastChannel<Answer, Call>(channelIds.answerChannelId, channelIds.callChannelId)
                })
            )
        }),
        /*
        startWith(undefined),
        switchMap(channel => {

        })
        timeout({
            first: 100,
            with: () => {
                return throwError(() => "Timeout when contacting migrating worker.")
            }
        }),*/
    )
}

function buildBackEnd(context: string, createBroadcastChannel: BroadcastChannelCreator) {
    return observeWebLock(context).pipe(
        switchMap(() => {
            const registrationId = generateId()
            const registration = Channel.broadcast<RegistrationMessage>(registrationId, [{ type: "workerDied" }])
            return merge(
                backEndLookup(context, registrationId).pipe(ignoreElements()),
                registration.pipe(
                    switchMap(connection => {
                        return connection.pipe(
                            mergeMap(message => {
                                if (message.type === "registerClient") {
                                    connection.next({
                                        type: "clientRegistered",
                                        clientId: message.clientId
                                    })
                                    return observeWebLock(message.lockId).pipe(
                                        map(() => {
                                            return {
                                                action: "delete" as const,
                                                clientId: message.clientId,
                                            }
                                        }),
                                        startWith({
                                            action: "add" as const,
                                            clientId: message.clientId,
                                            channel: createBroadcastChannel<Call, Answer>(message.callChannelId, message.answerChannelId)
                                        })
                                    )
                                }
                                else {
                                    return EMPTY
                                }
                            }),
                        )
                    })
                )
            )
        })
    )
}

type RegistrationMessage = {
    readonly type: "registerClient"
    readonly clientId: string
    readonly lockId: string
    readonly callChannelId: string
    readonly answerChannelId: string
} | {
    readonly type: "clientRegistered"
    readonly clientId: string
} | {
    readonly type: "workerDied"
}

function registerWithServer(channelId: string) {
    const lockId = generateId()
    return observeWebLock(lockId).pipe(
        switchMap(() => {
            const registration = Channel.broadcast<RegistrationMessage>(channelId)
            return registration.pipe(
                mergeMap(registration => {
                    const clientId = generateId()
                    const callChannelId = generateId()
                    const answerChannelId = generateId()
                    //TODO try to ensure proper priorities or just rely on locks?
                    registration.next({
                        type: "registerClient",
                        clientId,
                        lockId,
                        callChannelId,
                        answerChannelId,
                    })
                    return merge(
                        registration.pipe(
                            filter(message => message.type === "workerDied"),
                            first(),
                            map(() => undefined),
                            /*
                            mergeMap(() => {
                                return timer(maximumWait).pipe(
                                    mergeMap(() => {
                                        return throwError(() => new RemoteError("timeout", "Previous worker died, no new migrating worker was found within the timeout (" + maximumWait + "ms)."))
                                    })
                                )
                            }),*/
                        ),
                        registration.pipe(
                            filter(message => message.type === "clientRegistered" && message.clientId === clientId),
                            first(),
                            map(() => {
                                return {
                                    callChannelId,
                                    answerChannelId
                                }
                            }),
                        )
                    )
                })
            )
        })
    )
}

/**
 * Lookup
 */

type AskIfServerIsAvailableLookupMessage = {
    readonly type: "askIfServerIsAvailable"
}
type NewServerStartedLookupMessage = {
    readonly type: "newServerStarted"
    readonly channelId: string
}
type ServerIsAvailableLookupMessage = {
    readonly type: "serverIsAvailable"
    readonly channelId: string
}
type LookupMessage = AskIfServerIsAvailableLookupMessage | NewServerStartedLookupMessage | ServerIsAvailableLookupMessage

function backEndLookup(context: string, registrationChannelId: string) {
    return Channel.broadcast<LookupMessage>(context).pipe(
        switchMap(connection => {
            return connection.pipe(
                filter(message => message.type === "askIfServerIsAvailable"),
                map(() => {
                    return {
                        type: "serverIsAvailable" as const,
                        channelId: registrationChannelId
                    }
                }),
                startWith({
                    type: "newServerStarted" as const,
                    channelId: registrationChannelId
                }),
                tap(connection)
            )
        })
    )
}

function frontEndLookup(context: string = DEFAULT_CONTEXT) {
    return Channel.broadcast<LookupMessage>(context).pipe(
        tap(lookup => {
            lookup.next({
                type: "askIfServerIsAvailable"
            })
        }),
        switchMap(lookup => {
            return lookup.pipe(
                mergeMap(message => {
                    if (message.type === "newServerStarted" || message.type === "serverIsAvailable") {
                        return of(message.channelId)
                    }
                    return EMPTY
                }),
                first(),
                mergeWith(lookup.pipe(
                    mergeMap(message => {
                        if (message.type === "newServerStarted") {
                            return of(message.channelId)
                        }
                        return EMPTY
                    })
                )),
                /*
                timeout({
                    first: maximumWait,
                    with: () => {
                        return of(undefined)
                        //return throwError(() => new RemoteError("timeout", "No migrating worker was found within the timeout (" + maximumWait + "ms)."))
                    }
                })*/
            )
        })
    )
}

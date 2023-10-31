import { EMPTY, ObservableNotification, combineLatest, filter, first, from, ignoreElements, map, merge, mergeMap, of, shareReplay, startWith, switchMap, takeUntil, tap } from "rxjs"
import { BatcherOptions } from "./batcher"
import { Channel, ChannelFactory } from "./channel"
import { Answer, Call } from "./processing"
import { generateId, observeRandomWebLock, observeWebLock, waitForLock } from "./util"

export const DEFAULT_CONTEXT = "default"

export interface BroadcastCoordinatorOptions {

    readonly context?: string

}

export function broadcastFinder(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastFinder(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.dualBroadcast(id1, id2))
}
export function broadcastAdvertiser(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastAdvertiser(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.dualBroadcast(id1, id2))
}

export interface BroadcastCoordinatorBatchingOptions {

    readonly context?: string
    readonly batcher?: BatcherOptions

}

export function broadcastFinderBatching(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastFinder(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.batching(Channel.dualBroadcast(id1, id2)))
}
export function broadcastAdvertiserBatching(options: BroadcastCoordinatorOptions = {}) {
    return buildBroadcastAdvertiser(options.context ?? DEFAULT_CONTEXT, (id1, id2) => Channel.batching(Channel.dualBroadcast(id1, id2)))
}

type BroadcastChannelCreator = <I, O>(id1: string, id2: string) => Channel<I, O>

function buildBroadcastAdvertiser(context: string, createBroadcastChannel: BroadcastChannelCreator) {
    return observeWebLock(context).pipe(
        switchMap(() => {
            const registrationChannelId = generateId()
            const registration = Channel.broadcast<RegistrationMessage>(registrationChannelId)
            return merge(
                combineLatest([
                    Channel.broadcast<LookupMessage>(context),
                    observeRandomWebLock()
                ]).pipe(
                    switchMap(([lookupConnection, lockId]) => {
                        return lookupConnection.pipe(
                            filter(message => message.type === "askIfWorkerIsAvailable"),
                            map(() => {
                                return {
                                    type: "workerIsAvailable" as const,
                                    registrationChannelId,
                                    lockId
                                }
                            }),
                            startWith({
                                type: "newWorkerStarted" as const,
                                registrationChannelId,
                                lockId
                            }),
                            tap(lookupConnection)
                        )
                    }),
                    ignoreElements()
                ),
                registration.pipe(
                    switchMap(connection => {
                        return connection.pipe(
                            mergeMap(message => message.type === "registerClient" ? of(message) : EMPTY),
                            mergeMap(message => {
                                connection.next({
                                    type: "clientRegistered",
                                    clientId: message.clientId
                                })
                                const lock = waitForLock(message.lockId)
                                return merge(
                                    of({
                                        action: "add" as const,
                                        key: message.clientId,
                                        observable: createBroadcastChannel<Call, ObservableNotification<Answer>>(message.callChannelId, message.answerChannelId)
                                    }),
                                    from(lock).pipe(
                                        map(() => {
                                            return {
                                                action: "delete" as const,
                                                key: message.clientId
                                            }
                                        })
                                    )
                                )
                            })
                        )
                    })
                )
            )
        })
    )
}

function buildBroadcastFinder(context: string, createBroadcastChannel: BroadcastChannelCreator): ChannelFactory<ObservableNotification<Answer>, Call> {
    return Channel.broadcast<LookupMessage>(context).pipe(
        switchMap(lookup => {
            lookup.next({
                type: "askIfWorkerIsAvailable"
            })
            return lookup.pipe(
                mergeMap(message => message.type === "newWorkerStarted" || message.type === "workerIsAvailable" ? of(message) : EMPTY),
                first(),
                switchMap(message => {
                    return merge(
                        of(message),
                        lookup.pipe(mergeMap(message => message.type === "newWorkerStarted" ? of(message) : EMPTY))
                    )
                }),
                switchMap(server => {
                    return observeRandomWebLock().pipe(
                        switchMap(lockId => {
                            const registration = Channel.broadcast<RegistrationMessage>(server.registrationChannelId)
                            return registration.pipe(
                                switchMap(registration => {
                                    const clientId = generateId()
                                    const callChannelId = generateId()
                                    const answerChannelId = generateId()
                                    registration.next({
                                        type: "registerClient",
                                        clientId,
                                        lockId,
                                        callChannelId,
                                        answerChannelId,
                                    })
                                    return registration.pipe(
                                        filter(message => message.type === "clientRegistered" && message.clientId === clientId),
                                        first(),
                                        map(() => {
                                            return createBroadcastChannel<ObservableNotification<Answer>, Call>(answerChannelId, callChannelId).pipe(
                                                takeUntil(waitForLock(server.lockId)),
                                                shareReplay(1)
                                                //TODO adding this fixed a bug where responses would get duplicated 50+ times
                                                //makes some kind of sense, but look into this a bit more to make sure best practices are being followed, here and in similar areas
                                                //looks like it still might be doing this to some extent, just not as bad, could be dropped due to refCount?
                                            )
                                        })
                                    )
                                })
                            )
                        }),
                    )
                })
            )
        }),
    )
}

/**
 * Lookup
 */

type LookupMessage = AskIfWorkerIsAvailableMessage | NewWorkerStartedMessage | WorkerIsAvailableMessage

type AskIfWorkerIsAvailableMessage = {
    readonly type: "askIfWorkerIsAvailable"
}

type NewWorkerStartedMessage = {
    readonly type: "newWorkerStarted"
    readonly registrationChannelId: string
    readonly lockId: string
}

type WorkerIsAvailableMessage = {
    readonly type: "workerIsAvailable"
    readonly registrationChannelId: string
    readonly lockId: string
}

type RegistrationMessage = RegisterClientMessage | ClientRegisteredMessage

type RegisterClientMessage = {
    readonly type: "registerClient"
    readonly clientId: string
    readonly lockId: string
    readonly callChannelId: string
    readonly answerChannelId: string
}

type ClientRegisteredMessage = {
    readonly type: "clientRegistered"
    readonly clientId: string
}

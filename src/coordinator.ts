import { Observable } from "rxjs"
import { broadcastCoordinator, broadcastCoordinatorBatching } from "./broadcast-coordinator"
import { Channel, VolatileChannel } from "./channel"
import { Answer, Call } from "./processing"

export type CoordinationAction = {
    readonly action: "add"
    readonly clientId: string
    readonly channel: Channel<Call, Answer>
} | {
    readonly action: "delete"
    readonly clientId: string
}

export namespace Coordinator {

    export const broadcast = broadcastCoordinator
    export const broadcastBatching = broadcastCoordinatorBatching

}

export interface Coordinator {

    readonly backEnd: Observable<CoordinationAction>
    readonly frontEnd: VolatileChannel<Answer, Call>

}

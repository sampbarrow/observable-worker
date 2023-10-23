import { Observable } from "rxjs"
import { broadcastCoordinator } from "./broadcast-coordinator"
import { Channel } from "./channel"
import { Answer, Call } from "./processing"

export type CoordinationAction = {
    readonly action: "added"
    readonly id: string
    readonly channel: Channel<Call, Answer>
} | {
    readonly action: "removed"
    readonly id: string
}

export namespace Coordinator {

    export const broadcast = broadcastCoordinator

}

export interface Coordinator {

    readonly backEnd: Observable<CoordinationAction>
    readonly frontEnd: Channel<Answer, Call>

}

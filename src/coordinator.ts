import { Observable, ObservableNotification } from "rxjs"
import { broadcastCoordinator, broadcastCoordinatorBatching } from "./broadcast-coordinator"
import { Connection, VolatileChannel } from "./channel"
import { Answer, Call } from "./processing"
import { RegistryAction } from "./util"

export namespace Coordinator {

    export const broadcast = broadcastCoordinator
    export const broadcastBatching = broadcastCoordinatorBatching

}

export interface Coordinator {

    readonly backEnd: Observable<RegistryAction<string, Connection<Call, ObservableNotification<Answer>>>>
    readonly frontEnd: VolatileChannel<ObservableNotification<Answer>, Call>

}

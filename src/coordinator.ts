import { Observable, ObservableNotification } from "rxjs"
import { Connection, VolatileChannel } from "./channel"
import { Answer, Call } from "./processing"
import { RegistryAction } from "./util"

export type Finder = VolatileChannel<ObservableNotification<Answer>, Call>
export type Advertiser = Observable<RegistryAction<string, Connection<Call, ObservableNotification<Answer>>>>

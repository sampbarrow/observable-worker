import { Observable, ObservableNotification } from "rxjs"
import { ChannelFactory, Connection } from "./channel"
import { Answer, Call } from "./processing"
import { RegistryAction } from "./util"

export type Finder = ChannelFactory<ObservableNotification<Answer>, Call>
export type Advertiser = Observable<RegistryAction<string, Connection<Call, ObservableNotification<Answer>>>>

import { ChannelSender, ChannelSenderOptions } from "./channel-sender"
import { Target } from "./processing"
import { Remote, SenderRemote } from "./remote"

export interface WrapOptions extends ChannelSenderOptions {
}

export function wrap<T extends Target>(options: WrapOptions): Remote<T> {
    return new SenderRemote<T>(new ChannelSender(options))
}

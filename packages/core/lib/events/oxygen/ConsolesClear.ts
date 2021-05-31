import { RevertableEvent } from "@skeldjs/events";
import { RepairSystemMessage } from "@skeldjs/protocol";
import { Hostable } from "../../Hostable";
import { PlayerData } from "../../PlayerData";
import { LifeSuppSystem } from "../../system";
import { ProtocolEvent } from "../ProtocolEvent";
import { RoomEvent } from "../RoomEvent";
import { O2Event } from "./O2Event";

export class O2ConsolesClearEvent extends RevertableEvent implements RoomEvent, O2Event, ProtocolEvent {
    static eventName = "o2.consoles.clear" as const;
    eventName = "o2.consoles.clear" as const;

    constructor(
        public readonly room: Hostable,
        public readonly oxygen: LifeSuppSystem,
        public readonly message: RepairSystemMessage|undefined,
        public readonly player: PlayerData|undefined
    ) {
        super();
    }
}
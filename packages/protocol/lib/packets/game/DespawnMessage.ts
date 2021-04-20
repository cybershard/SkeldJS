import { GameDataMessageTag } from "@skeldjs/constant";
import { HazelReader, HazelWriter } from "@skeldjs/util";
import { BaseGameDataMessage } from "./BaseGameDataMessage";

export class DespawnMessage extends BaseGameDataMessage {
    static tag = GameDataMessageTag.Despawn as const;
    tag = GameDataMessageTag.Despawn as const;

    readonly netid: number;

    constructor(netid: number) {
        super();

        this.netid = netid;
    }

    static Deserialize(reader: HazelReader) {
        const netid = reader.upacked();

        return new DespawnMessage(netid);
    }

    Serialize(writer: HazelWriter) {
        writer.upacked(this.netid);
    }
}

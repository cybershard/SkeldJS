import { RpcMessageTag } from "@skeldjs/constant";
import { HazelReader, HazelWriter } from "@skeldjs/util";

import { BaseRpcMessage } from "./BaseRpcMessage";

export class PlayAnimationMessage extends BaseRpcMessage {
    static tag = RpcMessageTag.PlayAnimation as const;
    tag = RpcMessageTag.PlayAnimation as const;

    taskid: number;

    constructor(taskid: number) {
        super();

        this.taskid = taskid;
    }

    static Deserialize(reader: HazelReader) {
        const taskid = reader.uint8();

        return new PlayAnimationMessage(taskid);
    }

    Serialize(writer: HazelWriter) {
        writer.uint8(this.taskid);
    }
}

import { HazelBuffer } from "@skeldjs/util"
import { SystemType } from "@skeldjs/constant";

import { BaseShipStatus } from "../component";
import { SystemStatus } from "./SystemStatus";
import { PlayerData } from "../PlayerData";

export interface MedScanSystemData {
    queue: number[];
}

export type MedScanSystemEvents = {

}

export class MedScanSystem extends SystemStatus<MedScanSystemEvents> {
    static systemType = SystemType.MedBay as const;
    systemType = SystemType.MedBay as const;

    queue: PlayerData[];

    constructor(ship: BaseShipStatus, data?: HazelBuffer|MedScanSystemData) {
        super(ship, data);
    }

    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    Deserialize(reader: HazelBuffer, spawn: boolean) {
        const num_players = reader.upacked();

        this.queue = [];
        for (let i = 0; i < num_players; i++) {
            this.queue.push(this.ship.room.getPlayerByPlayerId(reader.uint8()));
        }
    }

    /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
    Serialize(writer: HazelBuffer, spawn: boolean) {
        writer.upacked(this.queue.length);

        for (let i = 0; i < this.queue.length; i++) {
            writer.uint8(this.queue[i].playerId);
        }
    }

    HandleRepair(control: PlayerData, amount: number) {
        const playerId = amount & 0x1F;

        const player = this.ship.room.getPlayerByPlayerId(playerId);

        if (player) {
            if (amount & 0x80) {
                this.queue.push(player);
            } else if (amount & 0x40) {
                const idx = this.queue.indexOf(player);

                if (~idx) {
                    this.queue.splice(idx, 1);
                }
            }
        }
    }
}
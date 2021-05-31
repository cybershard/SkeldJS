import {
    SpawnMessage,
    GameOptions,
    BaseGameDataMessage,
    BaseRootMessage,
    DataMessage,
    AlterGameMessage,
    StartGameMessage,
    RemovePlayerMessage,
    DespawnMessage,
    ComponentSpawnData,
    PacketDecoder,
    RpcMessage,
    SceneChangeMessage,
    ReadyMessage,
    AllGameOptions,
} from "@skeldjs/protocol";

import {
    Code2Int,
    HazelReader,
    HazelWriter,
    sleep,
    Vector2,
} from "@skeldjs/util";

import {
    DisconnectReason,
    AlterGameTag,
    GameOverReason,
    SpawnType,
    SpawnFlag,
} from "@skeldjs/constant";

import { ExtractEventTypes } from "@skeldjs/events";

import {
    AirshipStatus,
    AprilShipStatus,
    CustomNetworkTransform,
    GameData,
    GameDataEvents,
    MiraShipStatus,
    LobbyBehaviour,
    LobbyBehaviourEvents,
    MeetingHud,
    MeetingHudEvents,
    PolusShipStatus,
    PlayerControl,
    PlayerPhysics,
    SkeldShipStatus,
    ShipStatusEvents,
    VoteBanSystem,
    VoteBanSystemEvents,
    PlayerIDResolvable,
} from "./component";

import { Heritable, HeritableEvents } from "./Heritable";
import { Networkable } from "./Networkable";
import { PlayerData, PlayerDataEvents } from "./PlayerData";

import { SpawnPrefabs } from "./prefabs";
import { HostableOptions } from "./misc/HostableOptions";

import {
    NetworkableDespawnEvent,
    NetworkableSpawnEvent,
    PlayerJoinEvent,
    PlayerLeaveEvent,
    PlayerSceneChangeEvent,
    PlayerSetHostEvent,
    RoomFixedUpdateEvent,
    RoomGameEndEvent,
    RoomGameStartEvent,
    RoomSetPrivacyEvent,
} from "./events";

export type RoomID = string | number;

export type PlayerDataResolvable =
    | number
    | PlayerData
    | PlayerControl
    | PlayerPhysics
    | CustomNetworkTransform;
export type PrivacyType = "public" | "private";

export interface SpawnObject {
    type: number;
    ownerid: number;
    flags: number;
    components: Networkable<any, any>[];
}

export type AnyNetworkable =
    | AirshipStatus
    | AprilShipStatus
    | CustomNetworkTransform
    | GameData
    | MiraShipStatus
    | LobbyBehaviour
    | MeetingHud
    | PolusShipStatus
    | PlayerControl
    | PlayerPhysics
    | SkeldShipStatus
    | VoteBanSystem;

export type HostableEvents = HeritableEvents &
    PlayerDataEvents &
    GameDataEvents &
    LobbyBehaviourEvents &
    MeetingHudEvents &
    ShipStatusEvents &
    VoteBanSystemEvents &
    ExtractEventTypes<
        [
            RoomGameStartEvent,
            RoomGameEndEvent,
            RoomFixedUpdateEvent,
            RoomSetPrivacyEvent
        ]
    >;

/**
 * Represents an object capable of hosting games.
 *
 * See {@link HostableEvents} for events to listen to.
 */
export class Hostable<
    T extends HostableEvents = HostableEvents
> extends Heritable<T> {
    /**
     * The objects in the room.
     */
    objects: Map<number, Heritable<any>>;

    /**
     * The players in the room.
     */
    players: Map<number, PlayerData>;

    /**
     * The networkable components in the room.
     */
    netobjects: Map<number, Networkable>;

    registeredPrefabs: Map<SpawnType, typeof Networkable[]>;

    /**
     * The current message stream to be sent to the server on fixed update.
     */
    stream: BaseGameDataMessage[];

    /**
     * The code of the room.
     */
    code: number;

    /**
     * The ID of the host of the room.
     */
    hostid: number;

    protected _incr_netid: number;

    /**
     * The settings of the room.
     */
    settings: GameOptions;

    /**
     * The current start counter for the room.
     */
    counter: number;

    /**
     * The privacy state of the room.
     */
    privacy: PrivacyType;

    /**
     * The packet decoder.
     */
    decoder: PacketDecoder;

    /**
     * Whether or not this room has been destroyed.
     */
    protected _destroyed: boolean;

    protected _started: boolean;
    protected last_fixed_update: number;

    protected _interval?: NodeJS.Timeout;

    constructor(public options: HostableOptions = {}) {
        super(null as unknown as Hostable<any>, -2);

        this.code = 0;
        this.hostid = -1;
        this.counter = -1;
        this.privacy = "private";

        this.settings = new GameOptions;

        this.objects = new Map;
        this.players = new Map;
        this.netobjects = new Map;
        this.registeredPrefabs = new Map;
        this.stream = [];

        this.objects.set(-2, this as Heritable<any>);
        this.room = this;

        this._incr_netid = 0;
        this._destroyed = false;
        this._started = false;

        this.decoder = new PacketDecoder;

        this.last_fixed_update = 0;

        if (options.doFixedUpdate) {
            this._interval = setInterval(
                this.FixedUpdate.bind(this),
                Hostable.FixedUpdateInterval
            );
        }

        this.decoder.on(AlterGameMessage, async message => {
            if (message.alterTag === AlterGameTag.ChangePrivacy) {
                const messagePrivacy = message.value ? "public" : "private";
                const oldPrivacy = this.privacy;
                const ev = await this.emit(
                    new RoomSetPrivacyEvent(
                        this,
                        message,
                        oldPrivacy,
                        messagePrivacy
                    )
                );

                if (ev.alteredPrivacy !== messagePrivacy) {
                    await this.broadcast([], true, undefined, [
                        new AlterGameMessage(
                            this.code,
                            AlterGameTag.ChangePrivacy,
                            ev.alteredPrivacy === "public" ? 1 : 0
                        )
                    ]);
                }

                if (ev.alteredPrivacy !== oldPrivacy) {
                    this._setPrivacy(ev.alteredPrivacy);
                }
            }
        });

        this.decoder.on(DataMessage, message => {
            const component = this.netobjects.get(message.netid);

            if (component) {
                const reader = HazelReader.from(message.data);
                component.Deserialize(reader);
            }
        });

        this.decoder.on(RpcMessage, async message => {
            const component = this.netobjects.get(message.netid);

            if (component) {
                try {
                    await component.HandleRpc(message.data);
                } catch (e) {
                    void e;
                }
            }
        });

        this.decoder.on(SpawnMessage, message => {
            for (let i = 0; i < message.components.length; i++) {
                const spawn_component = message.components[i];
                const owner = this.objects.get(message.ownerid);

                if (owner) {
                    const component = new SpawnPrefabs[message.spawnType][i](
                        this,
                        spawn_component.netid,
                        message.ownerid
                    );
                    const reader = HazelReader.from(spawn_component.data);
                    component.Deserialize(reader, true);

                    if (this.netobjects.get(component.netid)) continue;

                    this.spawnComponent(component);
                }
            }
        });

        this.decoder.on(DespawnMessage, message => {
            const component = this.netobjects.get(message.netid);

            if (component) {
                this._despawnComponent(component);
            }
        });

        this.decoder.on(SceneChangeMessage, async message => {
            const player = this.players.get(message.clientid);

            if (player) {
                if (message.scene === "OnlineGame") {
                    player.inScene = true;

                    const ev = await this.emit(
                        new PlayerSceneChangeEvent(
                            this,
                            player,
                            message
                        )
                    );

                    if (ev.canceled) {
                        player.inScene = false;
                    } else {
                        if (this.amhost) {
                            await this.broadcast(
                                this._getExistingObjectSpawn(),
                                true,
                                player
                            );

                            this.spawnPrefab(SpawnType.Player, player.id);

                            this.me?.control?.syncSettings(this.settings);
                        }
                    }
                }
            }
        });

        this.decoder.on(ReadyMessage, message => {
            const player = this.players.get(message.clientid);

            if (player) {
                player.ready();
            }
        });
    }

    destroy() {
        if (this._interval) clearInterval(this._interval);
        this._destroyed = true;
    }

    getNextNetId() {
        this._incr_netid++;

        return this._incr_netid;
    }

    /**
     * The current client in the room.
     */
    get me(): PlayerData | undefined {
        return undefined;
    }

    /**
     * The host of the room.
     */
    get host() {
        return this.players.get(this.hostid);
    }

    /**
     * Whether or not a game has started.
     */
    get started() {
        return this._started;
    }

    get destroyed() {
        return this._destroyed;
    }

    /**
     * Whether or not the current client is the host of the room.
     */
    get amhost() {
        return false;
    }

    /**
     * The shipstatus object for the room.
     */
    get shipstatus() {
        return this.getComponent<
            | SkeldShipStatus
            | MiraShipStatus
            | PolusShipStatus
            | AprilShipStatus
            | AirshipStatus
        >([
            SkeldShipStatus,
            MiraShipStatus,
            PolusShipStatus,
            AprilShipStatus,
            AirshipStatus,
        ]);
    }

    /**
     * The meeting hud object for the room.
     */
    get meetinghud() {
        return this.getComponent(MeetingHud);
    }

    /**
     * The lobby behaviour object for the room.
     */
    get lobbybehaviour() {
        return this.getComponent(LobbyBehaviour);
    }

    /**
     * The game data object for the room.
     */
    get gamedata() {
        return this.getComponent(GameData);
    }

    /**
     * The vote ban system object for the room.
     */
    get votebansystem() {
        return this.getComponent(VoteBanSystem);
    }

    async broadcast(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        messages: BaseGameDataMessage[],
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        reliable: boolean = true,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        recipient: PlayerData | undefined = undefined,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        payloads: BaseRootMessage[] = []
        // eslint-disable-next-line @typescript-eslint/no-empty-function
    ) {}

    async FixedUpdate() {
        const delta = Date.now() - this.last_fixed_update;
        this.last_fixed_update = Date.now();
        for (const [, component] of this.netobjects) {
            if (
                component &&
                (component.ownerid === this.me?.id || this.amhost)
            ) {
                component.FixedUpdate(delta / 1000);
                if (component.dirtyBit) {
                    component.PreSerialize();
                    const writer = HazelWriter.alloc(0);
                    if (component.Serialize(writer, false)) {
                        this.stream.push(
                            new DataMessage(component.netid, writer.buffer)
                        );
                    }
                    component.dirtyBit = 0;
                }
            }
        }

        const ev = await this.emit(
            new RoomFixedUpdateEvent(
                this,
                this.stream
            )
        );

        if (this.stream.length) {
            const stream = this.stream;
            this.stream = [];

            if (!ev.canceled) await this.broadcast(stream);
        }
    }

    /**
     * Resolve a player by some identifier.
     * @param player The identifier to resolve to a player.
     * @returns The resolved player.
     * @example
     *```typescript
     * // Resolve a player by their clientid.
     * const player = room.resolvePlayer(11013);
     * ```
     */
    resolvePlayer(player: PlayerDataResolvable) {
        const clientid = this.resolvePlayerClientID(player);

        if (clientid === undefined) return undefined;

        return this.players.get(clientid);
    }

    /**
     * Resolve a player ID by some identifier.
     * @param player The identifier to resolve to a player ID.
     * @returns The resolved player ID.
     */
    resolvePlayerId(player: PlayerIDResolvable) {
        if (typeof player === "undefined") {
            return undefined;
        }

        if (typeof player === "number") {
            return player;
        }

        return player.playerId;
    }

    /**
     * Resolve a clientid by some identifier.
     * @param player The identifier to resolve to a client ID.
     * @returns The resolved client ID.
     */
    resolvePlayerClientID(player: PlayerDataResolvable) {
        if (typeof player === "undefined") {
            return undefined;
        }

        if (typeof player === "number") {
            return player;
        }

        if (player instanceof Networkable) {
            return player.ownerid;
        }

        if (player instanceof PlayerData) {
            return player.id;
        }

        return undefined;
    }

    /**
     * Set the code of the room.
     * @example
     *```typescript
     * room.setCode("ABCDEF");
     * ```
     */
    setCode(code: RoomID): void {
        if (typeof code === "string") {
            return this.setCode(Code2Int(code));
        }

        this.code = code;
    }

    protected _setPrivacy(privacy: PrivacyType) {
        this.privacy = privacy;
    }

    /**
     * Change the the privacy of the room.
     * @param tag The tag to change.
     * @param value The new value of the tag.
     * @example
     *```typescript
     * room.setAlterGameTag(AlterGameTag.ChangePrivacy, 1); // 0 for private, 1 for public.
     * ```
     */
    async setPrivacy(privacy: PrivacyType) {
        const oldPrivacy = this.privacy;
        this._setPrivacy(privacy);

        const ev = await this.emit(
            new RoomSetPrivacyEvent(
                this,
                undefined,
                oldPrivacy,
                privacy
            )
        );

        this._setPrivacy(ev.alteredPrivacy);

        if (ev.alteredPrivacy !== oldPrivacy) {
            await this.broadcast([], true, undefined, [
                new AlterGameMessage(
                    this.code,
                    AlterGameTag.ChangePrivacy,
                    this.privacy === "public" ? 1 : 0
                ),
            ]);
        }
    }

    /**
     * Change the settings of the room. If the host, it will broadcast these changes.
     * @param settings The settings to set to (Can be partial).
     * @example
     *```typescript
     * room.syncSettings({
     *   crewmateVision: 0.5,
     *   votingTime: 120
     * });
     * ```
     */
    setSettings(settings: Partial<AllGameOptions>) {
        this.settings.patch(settings);

        if (this.amhost) {
            if (this.me?.control) {
                this.me.control.syncSettings(this.settings);
            }
        }
    }

    /**
     * Set the host of the room. If the current client is the host, it will conduct required host changes.
     * e.g. Spawning objects if they are not already spawned.
     * @param host The new host of the room.
     */
    async setHost(host: PlayerDataResolvable) {
        const before = this.hostid;
        const resolved_id = this.resolvePlayerClientID(host);

        if (!resolved_id) return;

        this.hostid = resolved_id;

        if (this.amhost) {
            if (!this.lobbybehaviour) {
                this.spawnPrefab(SpawnType.LobbyBehaviour, -2);
            }

            if (!this.gamedata) {
                this.spawnPrefab(SpawnType.GameData, -2);
            }
        }

        if (before !== this.hostid && this.host) {
            await this.host.emit(new PlayerSetHostEvent(this, this.host));
        }
    }

    /**
     * Handle when a client joins the game.
     * @param clientid The ID of the client that joined the game.
     */
    async handleJoin(clientid: number) {
        if (this.objects.has(clientid)) return null;

        const player: PlayerData = new PlayerData(this, clientid);
        this.players.set(clientid, player);
        this.objects.set(clientid, player as Heritable<any>);

        player.emit(new PlayerJoinEvent(this, player));

        return player;
    }

    /**
     * Handle when a client leaves the game.
     * @param resolvable The client that left the game.
     */
    async handleLeave(resolvable: PlayerDataResolvable) {
        const player = this.resolvePlayer(resolvable);

        if (!player) return null;

        if (player.playerId !== undefined) {
            if (this.gamedata && this.gamedata.players.get(player.playerId)) {
                this.gamedata.remove(player.playerId);
            }
        }

        if (this.votebansystem && this.votebansystem.voted.get(player.id)) {
            this.votebansystem.voted.delete(player.id);
        }

        for (let i = 0; i < player.components.length; i++) {
            const component = player.components[i];

            if (component) await this.despawnComponent(component);
        }

        this.players.delete(player.id);
        this.objects.delete(player.id);

        this.emit(
            new PlayerLeaveEvent(this, player)
        );

        return player;
    }

    /**
     * Handle when the game is started.
     */
    protected async _handleStart() {
        if (this._started) return;
        this._started = true;

        if (this.amhost) {
            await Promise.all([
                Promise.race([
                    Promise.all(
                        [...this.players.values()].map((player) => {
                            if (player.isReady) {
                                return Promise.resolve();
                            }

                            return new Promise<void>((resolve) => {
                                player.once("player.ready", () => {
                                    resolve();
                                });
                            });
                        })
                    ),
                    sleep(3000),
                ]),
                this.me?.ready(),
            ]);

            const removes = [];
            for (const [clientId, player] of this.players) {
                if (!player.isReady) {
                    await this.handleLeave(player);
                    removes.push(clientId);
                }
            }

            if (removes.length) {
                await this.broadcast(
                    [],
                    true,
                    undefined,
                    removes.map((clientid) => {
                        return new RemovePlayerMessage(
                            this.code,
                            clientid,
                            DisconnectReason.Error
                        );
                    })
                );
            }

            if (this.lobbybehaviour)
                await this.despawnComponent(
                    this.lobbybehaviour as Networkable<any, any>
                );

            const ship_prefabs = [
                SpawnType.ShipStatus,
                SpawnType.Headquarters,
                SpawnType.PlanetMap,
                SpawnType.AprilShipStatus,
                SpawnType.Airship
            ];

            await this.emit(new RoomGameStartEvent(this));
            this.spawnPrefab(ship_prefabs[this.settings?.map] || 0, -2);
            await this.shipstatus?.selectImpostors();

            for (const [, player] of this.players) {
                this.room.gamedata?.setTasks(player, [1, 2, 3]);
            }
        } else {
            await this.emit(new RoomGameStartEvent(this));
            if (this.me) await this.me.ready();
        }
    }

    /**
     * Start a game.
     */
    async requestStartGame() {
        await this.broadcast([], true, undefined, [new StartGameMessage(this.code)]);
    }

    private async _endGame(reason: GameOverReason) {
        this._started = false;
        await this.emit(new RoomGameEndEvent(this, reason));
    }

    /**
     * Handle when the game is ended.
     * @param reason The reason for why the game ended.
     */
    async handleEnd(reason: GameOverReason) {
        await this._endGame(reason);
    }

    /**
     * End the current game.
     */
    async endGame(reason: GameOverReason) {
        return await this.handleEnd(reason);
    }

    /**
     * Handle a client readying up.
     * @param player The client that readied.
     */
    async handleReady(player: PlayerDataResolvable) {
        const resolved = this.resolvePlayer(player);

        if (resolved) {
            await resolved.ready();
        }
    }

    /**
     * Spawn a component (Not broadcasted to all clients, see {@link Hostable.spawnPrefab}).
     * @param component The component being spawned.
     * @example
     *```typescript
     * const meetinghud = new MeetingHud(
     *   this,
     *   this.getNextNetId(),
     *   ownerid,
     *   {
     *     dirtyBit: 0,
     *     states: new Map(),
     *   }
     * );
     *
     * this.spawnComponent(meetinghud);
     * ```
     */
    spawnComponent(component: Networkable<any, any>) {
        if (this.netobjects.get(component.netid)) {
            return;
        }

        this.netobjects.set(component.netid, component);
        component.owner?.components.push(component);

        component.emit(
            new NetworkableSpawnEvent(this, component as AnyNetworkable)
        );
    }

    private _despawnComponent(component: Networkable<any>) {
        this.netobjects.delete(component.netid);

        component.emit(
            new NetworkableDespawnEvent(this, component as AnyNetworkable)
        );
        component.owner?.components.splice(
            component.owner.components.indexOf(component),
            1,
            null
        );
    }

    /**
     * Despawn a component.
     * @param component The component being despawned.
     * @example
     *```typescript
     * room.despawnComponent(room.meetinghud);
     * ```
     */
    despawnComponent(component: Networkable<any, any>) {
        this._despawnComponent(component);

        this.stream.push(new DespawnMessage(component.netid));
    }

    /**
     * Get an available player ID.
     * @returns The player ID that was found.
     * @example
     *```typescript
     * // Get an available player ID and add it to the gamedata.
     * const playerId = room.getAvailablePlayerID();
     * room.gamedata.add(playerId);
     * ```
     */
    getAvailablePlayerID() {
        for (let i = 0; ; i++) {
            if (!this.getPlayerByPlayerId(i)) {
                return i;
            }
        }
    }

    /**
     * Spawn a prefab of an object.
     * @param type The type of object to spawn.
     * @param owner The owner or ID of the owner of the object to spawn.
     * @returns The object that was spawned.
     * @example
     *```typescript
     * room.spawnPrefab(SpawnType.Player, client.me);
     * ```
     */
    spawnPrefab(type: SpawnType, owner: Heritable<any> | number): SpawnObject {
        const ownerid = typeof owner === "number" ? owner : owner.id;

        const object: SpawnObject = {
            type,
            ownerid,
            flags: type === SpawnType.Player ? 1 : 0,
            components: [],
        };

        switch (type) {
            case SpawnType.ShipStatus: {
                const shipstatus = new SkeldShipStatus(
                    this,
                    this.getNextNetId(),
                    ownerid
                );

                object.components.push(shipstatus as Networkable<any, any>);
                break;
            }
            case SpawnType.MeetingHud:
                const meetinghud = new MeetingHud(
                    this,
                    this.getNextNetId(),
                    ownerid,
                    {
                        states: new Map,
                    }
                );

                object.components.push(meetinghud as Networkable<any, any>);
                break;
            case SpawnType.LobbyBehaviour:
                const lobbybehaviour = new LobbyBehaviour(
                    this,
                    this.getNextNetId(),
                    ownerid,
                    {}
                );

                object.components.push(lobbybehaviour as Networkable<any, any>);
                break;
            case SpawnType.GameData:
                const gamedata = new GameData(this, this.getNextNetId(), ownerid, {
                    players: new Map,
                });

                for (const [, player] of this.players) {
                    if (player.playerId) gamedata.add(player.playerId);
                }

                const votebansystem = new VoteBanSystem(
                    this,
                    this.getNextNetId(),
                    ownerid,
                    {
                        voted: new Map,
                    }
                );

                object.components.push(gamedata as Networkable<any, any>);
                object.components.push(votebansystem as Networkable<any, any>);
                break;
            case SpawnType.Player:
                const playerId = this.getAvailablePlayerID();

                if (this.gamedata) this.gamedata.add(playerId);

                const control = new PlayerControl(
                    this,
                    this.getNextNetId(),
                    ownerid,
                    {
                        isNew: true,
                        playerId,
                    }
                );

                const physics = new PlayerPhysics(
                    this,
                    this.getNextNetId(),
                    ownerid,
                    {
                        ventid: -1,
                    }
                );

                const transform = new CustomNetworkTransform(
                    this,
                    this.getNextNetId(),
                    ownerid,
                    {
                        seqId: 1,
                        position: Vector2.null,
                        velocity: Vector2.null,
                    }
                );

                object.components.push(control as Networkable<any, any>);
                object.components.push(physics as Networkable<any, any>);
                object.components.push(transform as Networkable<any, any>);
                break;
            case SpawnType.Headquarters:
                const headquarters = new MiraShipStatus(
                    this,
                    this.getNextNetId(),
                    ownerid
                );

                object.components.push(headquarters as Networkable<any, any>);
                break;
            case SpawnType.PlanetMap:
                const planetmap = new PolusShipStatus(
                    this,
                    this.getNextNetId(),
                    ownerid
                );

                object.components.push(planetmap as Networkable<any, any>);
                break;
            case SpawnType.AprilShipStatus:
                const aprilshipstatus = new AprilShipStatus(
                    this,
                    this.getNextNetId(),
                    ownerid
                );

                object.components.push(
                    aprilshipstatus as Networkable<any, any>
                );
                break;
            case SpawnType.Airship:
                const airship = new AirshipStatus(
                    this,
                    this.getNextNetId(),
                    ownerid
                );

                object.components.push(airship as Networkable<any, any>);
                break;
        }

        for (const component of object.components) {
            this.spawnComponent(component);
        }

        this.stream.push(
            new SpawnMessage(
                type,
                object.ownerid,
                object.flags,
                object.components.map((component) => {
                    const writer = HazelWriter.alloc(0);
                    writer.write(component, true);

                    return new ComponentSpawnData(
                        component.netid,
                        writer.buffer
                    );
                })
            )
        );

        return object as SpawnObject;
    }

    /**
     * Get a player by their player ID.
     * @param playerId The player ID of the player.
     * @returns The player that was found, or null if they do not exist.
     * @example
     * ```typescript
     * const player = room.getPlayerByPlayerId(1);
     * ```
     */
    getPlayerByPlayerId(playerId: number) {
        for (const [, player] of this.players) {
            if (player.playerId === playerId) return player;
        }

        return undefined;
    }

    /**
     * Get a player by one of their components' netids.
     * @param netid The network ID of the component of the player to search.
     * @returns The player that was found, or null if they do not exist.
     * @example
     * ```typescript
     * const player = room.getPlayerByNetId(34);
     * ```
     */
    getPlayerByNetId(netid: number) {
        for (const [, player] of this.players) {
            if (
                player.components.find(
                    (component) => component?.netid === netid
                )
            )
                return player;
        }

        return undefined;
    }

    private _getExistingObjectSpawn() {
        const messages: SpawnMessage[] = [];

        for (const [, netobj] of this.netobjects) {
            let message = messages.find(
                (msg) =>
                    msg.spawnType === netobj.type &&
                    msg.ownerid === netobj.ownerid
            );

            if (!message) {
                message = new SpawnMessage(
                    netobj.type,
                    netobj.ownerid,
                    netobj.classname === "PlayerControl"
                        ? SpawnFlag.IsClientCharacter
                        : SpawnFlag.None,
                    []
                );

                messages.push(message);
            }

            const writer = HazelWriter.alloc(0);
            writer.write(netobj, true);

            message.components.push(
                new ComponentSpawnData(netobj.netid, writer.buffer)
            );
        }

        return messages;
    }

    /**
     * How often a FixedUpdate should be called.
     */
    static FixedUpdateInterval = 1 / 50;
}

import assert from "assert";

import { Heritable, HeritableEvents } from "./Heritable";
import { Hostable, HostableEvents } from "./Hostable";

import { TestComponent, TestEvents, alphabet, TestEvent } from "./tests.spec";

describe("Heritable", () => {
    describe("Heritable#ctr", () => {
        it("Should create an identifiable heritable object belonging to a room.", () => {
            const room = new Hostable;
            const heritable = new Heritable(room, 1013);

            assert.strictEqual(heritable.id, 1013);
            assert.strictEqual(heritable.room, room);
            assert.deepStrictEqual(heritable.components, []);
        });
    });

    describe("Heritable#emit", () => {
        it("Should emit an event that propagates through the room it belongs to.", async () => {
            let was_called1 = false;
            let was_called2 = false;

            const room: Hostable<HostableEvents & TestEvents> = new Hostable;
            const heritable = new Heritable<HeritableEvents & TestEvents>(
                room,
                1013
            );

            heritable.on("test.event", async (ev) => {
                if (ev.alphabet === alphabet) {
                    was_called1 = true;
                }
            });

            room.on("test.event", async (ev) => {
                if (ev.alphabet === alphabet) {
                    was_called2 = true;
                }
            });

            await heritable.emit(new TestEvent(alphabet));

            assert.ok(was_called1);
            assert.ok(was_called2);
        });
    });

    describe("Heritable#getComponent", () => {
        it("Should get a component of the object by the class of the component.", () => {
            const room = new Hostable;
            const heritable = new Heritable(room, 1013);
            const component = new TestComponent(room, 1, 1013);

            room.objects.set(heritable.id, heritable);
            room.spawnComponent(component);

            assert.strictEqual(
                heritable.getComponent(TestComponent),
                component
            );
        });

        it("Should get a component of the object by the net ID of the component.", () => {
            const room = new Hostable;
            const heritable = new Heritable(room, 1013);
            const component = new TestComponent(room, 1, 1013);

            room.objects.set(heritable.id, heritable);
            room.spawnComponent(component);

            assert.strictEqual(heritable.getComponent(1), component);
        });
    });
});

"""A local TCP fault relay between the API engine and PostgreSQL.

It produces real stalled handshakes and real half-open sockets, the same faults FP-275's
tests/integration/test_db_timeouts.py creates with stalled_database and SilencingProxy.
This is a separate relay, not a reuse of those test helpers, because the load runner also
has to account for every relay task and socket after each cycle: a connection the pool has
forgotten but whose socket is still open is the leak this run exists to catch.
"""

import asyncio
import logging
from dataclasses import dataclass

BUFFER_SIZE = 65536
TEARDOWN_SECONDS = 5.0

logger = logging.getLogger(__name__)


@dataclass(eq=False)
class Relay:
    silent: bool = False


class FaultProxy:
    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.server: asyncio.Server | None = None
        self.stall_new = False
        self.stalled = 0
        self.silenced = 0
        self.errors: list[str] = []
        self.relays: list[Relay] = []
        self.writers: set[asyncio.StreamWriter] = set()
        self.tasks: set[asyncio.Task[None]] = set()
        self.pumps: set[asyncio.Task[None]] = set()
        self.resume = asyncio.Event()

    async def start(self) -> int:
        self.server = await asyncio.start_server(self.accept, "127.0.0.1", 0)
        return int(self.server.sockets[0].getsockname()[1])

    def accept(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.create_task(self.relay(reader, writer))
        self.tasks.add(task)
        task.add_done_callback(self.finished)

    def record_error(self, error: BaseException) -> None:
        logger.warning("Fault relay error error_type=%s", type(error).__name__)
        self.errors.append(type(error).__name__)

    def finished(self, task: asyncio.Task[None]) -> None:
        self.tasks.discard(task)
        if not task.cancelled() and (error := task.exception()) is not None:
            self.record_error(error)

    def silence(self) -> None:
        for relay in self.relays:
            if not relay.silent:
                relay.silent = True
                self.silenced += 1

    def restore(self) -> None:
        self.stall_new = False
        self.resume.set()
        for relay in self.relays:
            relay.silent = False

    async def pump(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, relay: Relay) -> None:
        try:
            while data := await reader.read(BUFFER_SIZE):
                if not relay.silent:
                    writer.write(data)
                    await writer.drain()
        except ConnectionError:
            return
        finally:
            writer.close()

    async def relay(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.writers.add(writer)
        relay = Relay()
        self.relays.append(relay)
        outgoing: asyncio.StreamWriter | None = None
        try:
            if self.stall_new:
                self.stalled += 1
                await self.resume.wait()
            upstream, outgoing = await asyncio.open_connection(*self.target)
            self.writers.add(outgoing)
            async with asyncio.TaskGroup() as group:
                for source, destination in ((reader, outgoing), (upstream, writer)):
                    task = group.create_task(self.pump(source, destination, relay))
                    self.pumps.add(task)
                    task.add_done_callback(self.pumps.discard)
        except OSError as exc:
            self.record_error(exc)
        finally:
            writer.close()
            self.writers.discard(writer)
            if outgoing is not None:
                outgoing.close()
                self.writers.discard(outgoing)
            self.relays.remove(relay)

    async def close(self) -> None:
        if self.server is not None:
            self.server.close()
        for writer in tuple(self.writers):
            writer.close()
        tasks = tuple(self.tasks)
        for task in tasks:
            task.cancel()
        async with asyncio.timeout(TEARDOWN_SECONDS):
            await asyncio.gather(*tasks, return_exceptions=True)
            if self.server is not None:
                await self.server.wait_closed()

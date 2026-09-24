// Streams a ZIP archive straight to a writable (an HTTP response) without
// building it on disk first: the hosted app's /tmp is memory, and a bundle is
// as large as everything in it. Entries are stored (no compression; the media
// is already compressed) with data descriptors, so sizes and CRCs are written
// after each file streams through.
import fs from "node:fs";
import zlib from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
// zlib.crc32 exists from Node 22.2; the table covers older runtimes.
const crc32 = zlib.crc32
  ? (bytes, previous = 0) => zlib.crc32(bytes, previous)
  : (bytes, previous = 0) => {
      let c = (previous ^ 0xffffffff) >>> 0;
      for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };

const LIMIT = 0xffffffff;
function dosTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

// entries: [{ name, file } | { name, data: Buffer|string }]
export async function streamZip(out, entries, { signal } = {}) {
  const write = (chunk) =>
    new Promise((resolve, reject) => {
      if (out.write(chunk)) return resolve();
      const onDrain = () => {
        out.off("error", onError);
        resolve();
      };
      const onError = (error) => {
        out.off("drain", onDrain);
        reject(error);
      };
      out.once("drain", onDrain);
      out.once("error", onError);
    });
  const { time, date } = dosTime(new Date());
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    signal?.throwIfAborted();
    const name = Buffer.from(entry.name, "utf8");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0808, 6); // sizes follow the data; UTF-8 names
    header.writeUInt16LE(0, 8); // stored
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt16LE(name.length, 26);
    const start = offset;
    await write(header);
    await write(name);
    offset += header.length + name.length;
    let crc = 0,
      size = 0;
    if (entry.file) {
      for await (const chunk of fs.createReadStream(entry.file, { highWaterMark: 1024 * 1024 })) {
        signal?.throwIfAborted();
        crc = crc32(chunk, crc);
        size += chunk.length;
        await write(chunk);
      }
    } else {
      const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data ?? ""), "utf8");
      crc = crc32(data);
      size = data.length;
      await write(data);
    }
    offset += size;
    if (offset > LIMIT) throw new Error("The bundle is larger than 4 GB");
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    await write(descriptor);
    offset += descriptor.length;
    central.push({ name, crc, size, start });
  }
  const cdStart = offset;
  for (const item of central) {
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0808, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(date, 14);
    record.writeUInt32LE(item.crc >>> 0, 16);
    record.writeUInt32LE(item.size, 20);
    record.writeUInt32LE(item.size, 24);
    record.writeUInt16LE(item.name.length, 28);
    record.writeUInt32LE(item.start, 42);
    await write(record);
    await write(item.name);
    offset += record.length + item.name.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(offset - cdStart, 12);
  end.writeUInt32LE(cdStart, 16);
  await write(end);
}

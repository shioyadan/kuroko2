const { readFileSync } = require("node:fs");

// Reuse DejaVu's real glyphs without bundling proprietary Windows fonts. Only
// font-family/style metadata changes; this tests font resolution, not fidelity.
function fontMetadataFixture(family, weight = 400, embeddingFlags = 0) {
    const source = Uint8Array.from(readFileSync(process.env.TEST_FONT_PATH || "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"));
    const style = weight >= 700 ? "Bold" : "Regular";
    const postscript = "Fixture-" + family.replace(/[^a-z0-9]/gi, "") + "-" + style;
    const names = [[1, family], [2, style], [4, `${family} ${style}`], [6, postscript], [16, family], [17, style]];
    const strings = names.map(([, value]) => Uint8Array.from([...value].flatMap(char => [char.charCodeAt(0) >> 8, char.charCodeAt(0) & 255])));
    const stringsOffset = 6 + names.length * 12;
    const nameTable = new Uint8Array(stringsOffset + strings.reduce((sum, bytes) => sum + bytes.length, 0));
    const tableView = new DataView(nameTable.buffer);
    tableView.setUint16(2, names.length); tableView.setUint16(4, stringsOffset);
    let stringOffset = 0;
    names.forEach(([id], i) => {
        const record = 6 + i * 12;
        [3, 1, 0x409, id, strings[i].length, stringOffset].forEach((value, j) => tableView.setUint16(record + j * 2, value));
        nameTable.set(strings[i], stringsOffset + stringOffset);
        stringOffset += strings[i].length;
    });
    const nameOffset = (source.length + 3) & ~3;
    const bytes = new Uint8Array((nameOffset + nameTable.length + 3) & ~3);
    bytes.set(source); bytes.set(nameTable, nameOffset);
    const view = new DataView(bytes.buffer);
    let headOffset;
    for (let i = 0; i < view.getUint16(4); i++) {
        const record = 12 + i * 16;
        const tag = String.fromCharCode(...bytes.subarray(record, record + 4));
        const offset = view.getUint32(record + 8);
        if (tag === "name") { view.setUint32(record + 8, nameOffset); view.setUint32(record + 12, nameTable.length); }
        if (tag === "OS/2") {
            view.setUint16(offset + 4, weight); view.setUint16(offset + 8, embeddingFlags);
            view.setUint16(offset + 62, weight >= 700 ? 0x20 : 0x40);
        }
        if (tag === "head") {
            headOffset = offset;
            view.setUint32(offset + 8, 0);
            view.setUint16(offset + 44, weight >= 700 ? 1 : 0);
        }
    }
    const checksum = (offset, length) => {
        let sum = 0;
        for (let i = 0; i < length; i += 4) {
            let word = 0;
            for (let j = 0; j < 4; j++) word = ((word << 8) | (i + j < length ? bytes[offset + i + j] : 0)) >>> 0;
            sum = (sum + word) >>> 0;
        }
        return sum;
    };
    for (let i = 0; i < view.getUint16(4); i++) {
        const record = 12 + i * 16;
        view.setUint32(record + 4, checksum(view.getUint32(record + 8), view.getUint32(record + 12)));
    }
    view.setUint32(headOffset + 8, (0xb1b0afba - checksum(0, bytes.length)) >>> 0);
    return bytes;
}

module.exports = { fontMetadataFixture };

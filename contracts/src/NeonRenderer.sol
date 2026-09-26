// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SSTORE2} from "solady/utils/SSTORE2.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibString} from "solady/utils/LibString.sol";
import {DynamicBufferLib} from "solady/utils/DynamicBufferLib.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NeonFaces} from "./NeonFaces.sol";
import {NeonSeeder} from "./NeonSeeder.sol";
import {NeonArt} from "./NeonArt.sol";

/// @title NeonRenderer — fully on-chain metadata and SVG for NEONFACES
/// @notice `tokenURI` is assembled entirely on-chain:
///  - the image is an SVG drawn from the pixel record stored in NeonArt (SSTORE2),
///  - the art traits are decoded from the same record,
///  - the Stare tier, the Face account (ERC-6551) and the seed basket are read live from NeonSeeder,
///  - the basket tickers are read from the Stock Token contracts themselves,
///  - set pieces show their set; an assembled set (one piece's account holds the other three) shows the
///    whole face, drawn from the four records side by side,
///  - the Gaze: the neon blooms after 30 / 90 / 365 days with the same holder ("Unblinking"); a sale resets it.
/// No IPFS, no server. This contract has no owner; its only storage (watchTokens) is set in the constructor.
contract NeonRenderer {
    using DynamicBufferLib for DynamicBufferLib.DynamicBuffer;
    using LibString for uint256;

    NeonFaces public immutable faces;
    NeonSeeder public immutable seeder;
    NeonArt public immutable art;
    address public immutable placeholder; // SSTORE2 pointer of the pre-reveal record
    address private immutable _siteURL; // SSTORE2 pointer of the external URL prefix
    /// @notice Extra tokens shown as "Holds <TICKER>" when the Face account holds them (set once, at deploy).
    address[] public watchTokens;

    uint256 private constant BG = 5;
    uint256 private constant PLACEHOLDER_ART_ID = 5555;
    uint256 private constant HEADER = 12; // grid + 11 trait bytes, then RLE runs
    uint256 private constant SINGLES = 3335; // art ids of set pieces start here, 4 per set

    constructor(
        NeonFaces faces_,
        NeonSeeder seeder_,
        NeonArt art_,
        bytes memory placeholderRecord,
        string memory siteURL_,
        address[] memory watchTokens_
    ) {
        faces = faces_;
        seeder = seeder_;
        art = art_;
        placeholder = SSTORE2.write(placeholderRecord);
        _siteURL = SSTORE2.write(bytes(siteURL_));
        require(watchTokens_.length <= 16, "too many tokens");
        watchTokens = watchTokens_;
    }

    function siteURL() public view returns (string memory) {
        return string(SSTORE2.read(_siteURL));
    }

    // ------------------------------------------------------------------
    // Token metadata
    // ------------------------------------------------------------------
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        NeonSeeder.SeedView memory s = seeder.seedOf(tokenId);
        (bool revealed, uint256 artId, bytes memory rec) = _artOf(tokenId);
        SetInfo memory set_;
        if (revealed) set_ = _set(tokenId);

        DynamicBufferLib.DynamicBuffer memory j;
        j.p('{"name":"NEONFACES #', bytes(tokenId.toString()), '","description":"They don\'t blink. Face #');
        j.p(bytes(tokenId.toString()), " is an account: ", bytes(LibString.toHexStringChecksummed(s.account)));
        j.p(". Whatever it holds travels with it.", set_.note);
        j.p(
            " Stock Tokens give economic exposure only, not legal ownership of the ",
            "underlying shares, and are not available to US persons. Art and metadata are fully on-chain.",
            '","image":"data:image/svg+xml;base64,'
        );
        j.p(bytes(Base64.encode(bytes(_image(tokenId, revealed ? artId : PLACEHOLDER_ART_ID, rec, set_.assembled ? set_.setId : 0, set_.fused)))));
        j.p('","external_url":"', bytes(siteURL()), "face/", bytes(tokenId.toString()));
        j.p('","account":"', bytes(LibString.toHexStringChecksummed(s.account)), '","attributes":[');
        j.p(_attr("Stare", _tierName(s.tier), false));
        if (revealed) {
            (string[11] memory names, string[11] memory values) = _traits(rec);
            for (uint256 i; i < 11; ++i) {
                if (bytes(values[i]).length != 0) j.p(_attr(names[i], values[i], true));
            }
            j.p(set_.attrs);
        } else {
            j.p(_attr("Status", "Unrevealed", true));
        }
        j.p(_attr("Seed", s.funded ? _basketLabel(s.legs) : (s.activated ? "Pending" : "None"), true));
        j.p(_attr("Seed Status", s.funded ? "Funded" : (s.activated ? "Pending" : "Inactive"), true));
        if (s.tier >= 2) j.p(_attr("Stare Upgrade", s.upgraded ? _basketLabel(s.upgradeLegs) : "Pending", true));
        j.p(_holdings(s, set_.bonus));
        j.p(_unblinking(tokenId));
        j.p(_lock(s.account));
        if (revealed) j.p(',{"trait_type":"Art ID","display_type":"number","value":', bytes(artId.toString()), "}");
        j.p("]}");
        return string.concat("data:application/json;base64,", Base64.encode(j.data));
    }

    /// @notice Raw SVG of a token (for sites and agents): the whole face when it anchors an assembled set.
    function svgOf(uint256 tokenId) external view returns (string memory) {
        (bool revealed, uint256 artId, bytes memory rec) = _artOf(tokenId);
        SetInfo memory set_;
        if (revealed) set_ = _set(tokenId);
        return _image(tokenId, revealed ? artId : PLACEHOLDER_ART_ID, rec, set_.assembled ? set_.setId : 0, set_.fused);
    }

    /// @notice Gaze level: 0, then 1 "Steady" / 2 "Fixed" / 3 "Burning" after 30 / 90 / 365 days with the same holder.
    function gazeOf(uint256 tokenId) public view returns (uint8) {
        uint256 since = faces.heldSince(tokenId);
        if (since == 0) return 0;
        uint256 d = (block.timestamp - since) / 1 days;
        return d >= 365 ? 3 : d >= 90 ? 2 : d >= 30 ? 1 : 0;
    }

    /// @dev The token's image: its art (or the whole face when `setId` != 0), with its Gaze; a fused set gets a neon
    /// frame one cell wide around the whole face (drawn by the renderer: the sealed art is untouched).
    function _image(uint256 tokenId, uint256 artId, bytes memory rec, uint256 setId, bool fused)
        internal
        view
        returns (string memory svg)
    {
        uint8 gaze = gazeOf(tokenId);
        if (setId == 0) return renderSVG(artId, rec, gaze);
        bytes[] memory recs = _setRecords(setId);
        svg = renderSetSVG(setId, recs, gaze);
        if (fused) {
            bytes memory b = bytes(svg);
            assembly {
                mstore(b, sub(mload(b), 6)) // drop "</svg>"
            }
            string memory inner = (2 * uint256(uint8(recs[0][0])) - 1).toString();
            svg = string.concat(
                string(b), '<rect x=".5" y=".5" width="', inner, '" height="', inner, '" fill="none" stroke="#CCFF00"/></svg>'
            );
        }
    }

    /// @dev Set attributes: "Set" n (a number, so marketplaces keep it out of rarity scores: every set is shared
    /// by only four Faces, which would rank any set piece above the rarest single), "Set Status" (Assembled /
    /// Inside Another Piece: two values, the ids go in the description) and the one-time "Set Bonus" (with its
    /// legs when this Face received it, so "Holds" lists them). `note` is the sentence added to the description.
    struct SetInfo {
        uint256 setId;
        bool assembled;
        bool fused;
        bytes attrs;
        NeonSeeder.Leg[] bonus;
        bytes note;
    }

    function _set(uint256 tokenId) internal view returns (SetInfo memory info) {
        uint256[4] memory members;
        uint256 setId;
        (setId,, members) = seeder.setOf(tokenId);
        if (setId == 0) return info;
        info.setId = setId;
        info.attrs = abi.encodePacked(',{"trait_type":"Set","display_type":"number","value":', setId.toString(), "}");
        info.assembled = seeder.isAssembled(tokenId);
        if (info.assembled) {
            (uint32 fusedInto, uint64 fusedAt) = seeder.fusedSet(setId);
            info.fused = fusedInto != 0;
            info.attrs = abi.encodePacked(info.attrs, _attr("Set Status", info.fused ? "Fused" : "Assembled", true));
            if (info.fused) {
                info.attrs = abi.encodePacked(info.attrs, ',{"trait_type":"Fused Since","display_type":"date","value":', uint256(fusedAt).toString(), "}");
            }
            bytes memory note = abi.encodePacked(" It holds the other three pieces of set ", setId.toString(), " (");
            uint256 listed;
            for (uint256 q; q < 4; ++q) {
                if (members[q] == tokenId) continue;
                note = abi.encodePacked(note, listed++ == 0 ? "#" : ", #", members[q].toString());
            }
            info.note = abi.encodePacked(
                note,
                info.fused
                    ? ") and shows the whole face. Fused for good: the pieces can never leave it, the set only changes hands whole."
                    : ") and shows the whole face: selling it sells the set."
            );
        } else {
            address owner = faces.ownerOf(tokenId);
            for (uint256 q; q < 4; ++q) {
                if (members[q] != tokenId && owner == seeder.accountOf(members[q])) {
                    info.attrs = abi.encodePacked(info.attrs, _attr("Set Status", "Inside Another Piece", true));
                    info.note = abi.encodePacked(" It sits inside Face #", members[q].toString(), ", a piece of the same set.");
                }
            }
        }
        (uint32 anchorId, uint32 basketId) = seeder.setBonus(setId);
        if (anchorId == tokenId) {
            info.bonus = seeder.basket(basketId);
            info.attrs = abi.encodePacked(info.attrs, _attr("Set Bonus", _basketLabel(info.bonus), true));
        }
    }

    function _setRecords(uint256 setId) internal view returns (bytes[] memory recs) {
        recs = new bytes[](4);
        for (uint256 q; q < 4; ++q) {
            recs[q] = art.artData(SINGLES + 4 * (setId - 1) + q);
        }
    }

    /// @notice Collection metadata (ERC-7572 contractURI), on-chain.
    function contractURI() external view returns (string memory) {
        (address receiver, uint256 fee) = faces.royaltyInfo(1, 10_000);
        DynamicBufferLib.DynamicBuffer memory j;
        j.p(
            '{"name":"NEONFACES","description":"They don\'t blink. 5555 close-up faces on Robinhood Chain; 555 faces ',
            "come in four pieces to collect and assemble. Every Face is an account (ERC-6551) seeded with Stock ",
            "Tokens. Art and metadata fully on-chain.",
            '","image":"data:image/svg+xml;base64,'
        );
        j.p(bytes(Base64.encode(bytes(renderSVG(PLACEHOLDER_ART_ID, SSTORE2.read(placeholder), 0)))));
        j.p('","external_link":"', bytes(siteURL()), '","seller_fee_basis_points":', bytes(fee.toString()));
        j.p(',"fee_recipient":"', bytes(LibString.toHexStringChecksummed(receiver)), '"}');
        return string.concat("data:application/json;base64,", Base64.encode(j.data));
    }

    function _artOf(uint256 tokenId) internal view returns (bool revealed, uint256 artId, bytes memory rec) {
        faces.ownerOf(tokenId); // reverts for nonexistent tokens
        if (faces.revealSeed() != 0 && art.isSealed()) {
            artId = seeder.artIdOf(tokenId);
            if (artId != type(uint256).max) return (true, artId, art.artData(artId));
        }
        return (false, 0, SSTORE2.read(placeholder));
    }

    // ------------------------------------------------------------------
    // SVG — mirrored byte for byte by art/neonfaces/onchain.py (render_svg)
    // ------------------------------------------------------------------
    /// @notice SVG of one art record with a Gaze level (0 = none).
    function renderSVG(uint256 artId, bytes memory rec, uint8 gaze) public pure returns (string memory) {
        bytes[] memory recs = new bytes[](1);
        recs[0] = rec;
        return _svg(artId, recs, 1, gaze);
    }

    /// @notice An assembled set (setId 1..555): its 4 pieces side by side on a 2G grid, grain keyed by 5555 + setId.
    function renderSetSVG(uint256 setId, bytes[] memory recs, uint8 gaze) public pure returns (string memory) {
        return _svg(PLACEHOLDER_ART_ID + setId, recs, 2, gaze);
    }

    function _svg(uint256 grainId, bytes[] memory recs, uint256 side, uint8 gaze) internal pure returns (string memory) {
        uint256 g = uint8(recs[0][0]);
        string[8] memory pal = _palette(uint8(recs[0][3])); // byte 3 = Neon trait

        DynamicBufferLib.DynamicBuffer[8] memory paths;
        for (uint256 q; q < recs.length; ++q) {
            _draw(paths, recs[q], g, (q % 2) * g, (q / 2) * g);
        }

        g *= side;
        bytes memory gs = bytes(g.toString());
        DynamicBufferLib.DynamicBuffer memory out;
        out.p('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ', gs, " ", gs);
        out.p('" width="1200" height="1200" shape-rendering="crispEdges">');
        if (gaze != 0) _bloom(out, gaze);
        out.p('<rect width="', gs, '" height="', gs);
        out.p('" fill="', bytes(pal[BG]), '"/>');
        for (uint256 c; c < 8; ++c) {
            if (c == BG || paths[c].data.length == 0) continue;
            out.p('<path fill="', bytes(pal[c]), '" d="', paths[c].data, '"/>');
        }
        if (gaze != 0) out.p("</g>");

        uint256 grain = uint8(recs[0][5]); // byte 5 = Grain trait
        if (grain == 1) _dusty(out, grainId, g);
        else if (grain == 2) _scan(out, grainId, g, gs);
        out.p("</svg>");
        return out.s();
    }

    /// @dev Gaze: the image screened with a blurred, dimmed copy of itself, so the neon bleeds into the dark.
    function _bloom(DynamicBufferLib.DynamicBuffer memory out, uint8 gaze) internal pure {
        bytes memory k = [bytes(".35"), ".55", ".8"][gaze - 1];
        out.p('<defs><filter id="b"><feGaussianBlur stdDeviation="', [bytes("0.6"), "0.9", "1.2"][gaze - 1]);
        out.p('"/><feComponentTransfer><feFuncR type="linear" slope="', k, '"/><feFuncG type="linear" slope="', k);
        out.p('"/><feFuncB type="linear" slope="', k, '"/></feComponentTransfer><feBlend in="SourceGraphic" mode="screen"/>');
        out.p('</filter></defs><g filter="url(#b)">');
    }

    /// @dev RLE runs of one record -> one path per palette color, offset by (ox, oy), split per row.
    function _draw(DynamicBufferLib.DynamicBuffer[8] memory paths, bytes memory rec, uint256 g, uint256 ox, uint256 oy)
        internal
        pure
    {
        uint256 pos;
        for (uint256 k = HEADER; k < rec.length; ++k) {
            uint256 c = uint8(rec[k]) >> 5;
            uint256 n = (uint8(rec[k]) & 31) + 1;
            while (n > 0) {
                uint256 x = pos % g;
                uint256 seg = n < g - x ? n : g - x;
                if (c != BG) _run(paths[c], ox + x, oy + pos / g, seg);
                pos += seg;
                n -= seg;
            }
        }
    }

        function _run(DynamicBufferLib.DynamicBuffer memory path, uint256 x, uint256 y, uint256 len) internal pure {
        bytes memory sg = bytes(len.toString());
        path.p("M", bytes(x.toString()), " ", bytes(y.toString()), "h", sg, "v1h-");
        path.p(sg, "z");
    }

    function _dusty(DynamicBufferLib.DynamicBuffer memory out, uint256 artId, uint256 g) internal pure {
        DynamicBufferLib.DynamicBuffer memory dark;
        DynamicBufferLib.DynamicBuffer memory light;
        for (uint256 i; i < 90; ++i) {
            uint256 r = uint256(keccak256(abi.encode(artId, i)));
            bytes memory sz = _dec2(8 + (r >> 64) % 18);
            bytes memory seg = abi.encodePacked(
                "M", _dec2(r % (g * 100)), " ", _dec2((r >> 32) % (g * 100)), "h", sz, "v", sz, "h-", sz, "z"
            );
            if ((r >> 96) % 10 < 7) dark.p(seg);
            else light.p(seg);
        }
        out.p('<path fill="#000" fill-opacity=".35" d="', dark.data, '"/>');
        out.p('<path fill="#fff" fill-opacity=".22" d="', light.data, '"/>');
    }

    function _scan(DynamicBufferLib.DynamicBuffer memory out, uint256 artId, uint256 g, bytes memory gs) internal pure {
        uint256 r = uint256(keccak256(abi.encode(artId, uint256(1000))));
        out.p(
            '<defs><pattern id="s" width="1" height=".5" patternUnits="userSpaceOnUse">',
            '<rect width="1" height=".15" fill-opacity=".28"/></pattern>',
            '<filter id="n" x="0" y="0" width="100%" height="100%">'
        );
        out.p(
            '<feTurbulence type="fractalNoise" baseFrequency="1.7" numOctaves="2" seed="',
            bytes((artId % 997).toString()),
            '"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .5 0"/></filter></defs>'
        );
        out.p('<rect width="', gs, '" height="', gs, '" fill="url(#s)"/><rect width="', gs, '" height="');
        out.p(gs, '" filter="url(#n)" opacity=".45"/><rect x="', _dec2(r % (g * 100 - 100)), '" width="');
        out.p(_dec2(20 + (r >> 32) % 80), '" height="', gs, '" fill="#fff" fill-opacity=".08"/>');
    }

    /// @dev hundredths -> "a.bc"
    function _dec2(uint256 v) internal pure returns (bytes memory) {
        uint256 f = v % 100;
        return abi.encodePacked((v / 100).toString(), ".", f < 10 ? "0" : "", f.toString());
    }

    function _palette(uint8 neon) internal pure returns (string[8] memory) {
        if (neon == 1) {
            return ["#000000", "#1c2304", "#3c4811", "#5f701e", "#89a61b", "#bcee00", "#f2ffc8", "#ffffff"];
        }
        if (neon == 2) {
            return ["#000000", "#202609", "#454e1b", "#6d7b2d", "#9cb432", "#d6ff1f", "#f2ffc8", "#ffffff"];
        }
        return ["#000000", "#1f2504", "#414d12", "#677920", "#94b21d", "#ccff00", "#f2ffc8", "#ffffff"];
    }

    // ------------------------------------------------------------------
    // Traits
    // ------------------------------------------------------------------
    /// @dev Face is "" (omitted) on single close-ups.
    function _traits(bytes memory rec) internal pure returns (string[11] memory n, string[11] memory v) {
        n = ["Crop", "Density", "Neon", "Edge", "Grain", "Light", "Expression", "Accessory", "Block", "Anomaly", "Face"];
        v[0] = [
            "Eye", "Nose", "Brow", "Cheek", "Temple", "Mouth", "Profile Edge", "Left Eye", "Right Eye", "Left Mouth",
            "Right Mouth"
        ][uint8(rec[1])];
        v[1] = ["Sparse", "Mid", "Heavy"][uint8(rec[2])];
        v[2] = ["Standard", "Deep", "Hot"][uint8(rec[3])];
        v[3] = ["Stair Step", "Hard Cut", "Bleed Dither"][uint8(rec[4])];
        v[4] = ["Clean Print", "Dusty", "Heavy Scan"][uint8(rec[5])];
        v[5] = ["Left", "Right", "Top"][uint8(rec[6])];
        v[6] = ["Flat", "Squint", "Glare", "Wide", "Tense"][uint8(rec[7])];
        v[7] = ["None", "Mole", "Scar", "Stud", "Tape", "Visor"][uint8(rec[8])];
        v[8] = ["Standard", "Fine", "Coarse"][uint8(rec[9])];
        v[9] = ["None", "Dead Pixel", "Inverted Blocks", "Extra-Wide Crop", "Double-Eye Fragment"][uint8(rec[10])];
        v[10] = ["", "Woman", "Man"][uint8(rec[11])];
    }

    function _tierName(uint8 tier) internal pure returns (string memory) {
        if (tier == 1) return "Glance";
        if (tier == 2) return "Watch";
        if (tier == 3) return "Heavy Stare";
        return "Unrevealed";
    }

    function _basketLabel(NeonSeeder.Leg[] memory legs) internal view returns (string memory label) {
        for (uint256 i; i < legs.length; ++i) {
            string memory sym;
            try IERC20Metadata(legs[i].token).symbol() returns (string memory x) {
                sym = x;
            } catch {
                sym = "?";
            }
            label = i == 0 ? sym : string.concat(label, " / ", sym);
        }
    }

    /// @dev Live balances of the seed tokens (base, top-up, set bonus) inside the Face account, as numbers so
    /// marketplaces show them as stats and keep them out of trait filters and rarity scores, e.g.
    /// {"trait_type":"Holds TSLA","display_type":"number","value":0.003}
    function _holdings(NeonSeeder.SeedView memory s, NeonSeeder.Leg[] memory bonus) internal view returns (bytes memory out) {
        uint256 n;
        uint256 seedCount;
        address[] memory tokens = new address[](s.legs.length + s.upgradeLegs.length + bonus.length + watchTokens.length);
        for (uint256 i; i < s.legs.length; ++i) n = _addUnique(tokens, n, s.legs[i].token);
        for (uint256 i; i < s.upgradeLegs.length; ++i) n = _addUnique(tokens, n, s.upgradeLegs[i].token);
        for (uint256 i; i < bonus.length; ++i) n = _addUnique(tokens, n, bonus[i].token);
        seedCount = n;
        for (uint256 i; i < watchTokens.length; ++i) n = _addUnique(tokens, n, watchTokens[i]);
        for (uint256 i; i < n; ++i) {
            address t = tokens[i];
            (bool ok1, bytes memory rb) = t.staticcall(abi.encodeCall(IERC20.balanceOf, (s.account)));
            (bool ok2, bytes memory rd) = t.staticcall(abi.encodeCall(IERC20Metadata.decimals, ()));
            if (!ok1 || !ok2 || rb.length < 32 || rd.length < 32) continue;
            if (i >= seedCount && abi.decode(rb, (uint256)) == 0) continue; // extra tokens only when held
            string memory sym;
            try IERC20Metadata(t).symbol() returns (string memory x) {
                sym = x;
            } catch {
                continue;
            }
            out = abi.encodePacked(
                out,
                ',{"trait_type":"',
                LibString.escapeJSON(string.concat("Holds ", sym)),
                '","display_type":"number","value":',
                _decimal(abi.decode(rb, (uint256)), abi.decode(rd, (uint8))),
                "}"
            );
        }
    }

    function _addUnique(address[] memory list, uint256 n, address t) internal pure returns (uint256) {
        for (uint256 k; k < n; ++k) if (list[k] == t) return n;
        list[n] = t;
        return n + 1;
    }

    /// @dev "Locked Until" (date) while the Face account is locked, by its own lock or the lock of a Face it sits
    /// inside: a buyer's guarantee the contents stay put.
    function _lock(address account) internal view returns (bytes memory) {
        if (account.code.length == 0) return "";
        (bool ok, bytes memory r) = account.staticcall{gas: 500_000}(abi.encodeWithSignature("effectiveLockedUntil()"));
        if (!ok || r.length < 32) return "";
        uint256 until = abi.decode(r, (uint256));
        if (until <= block.timestamp) return "";
        return abi.encodePacked(',{"trait_type":"Locked Until","display_type":"date","value":', until.toString(), "}");
    }

    /// @dev "Unblinking": days the current holder has kept the Face + the date its eyes opened + the Gaze it earned.
    function _unblinking(uint256 tokenId) internal view returns (bytes memory) {
        uint256 since = faces.heldSince(tokenId);
        if (since == 0) return "";
        uint8 gaze = gazeOf(tokenId);
        return abi.encodePacked(
            ',{"trait_type":"Unblinking Days","display_type":"number","value":',
            ((block.timestamp - since) / 1 days).toString(),
            '},{"trait_type":"Eyes Open Since","display_type":"date","value":',
            since.toString(),
            "}",
            gaze == 0 ? bytes("") : _attr("Gaze", ["Steady", "Fixed", "Burning"][gaze - 1], true)
        );
    }

    /// @dev fixed-point -> decimal string with up to 6 fractional digits, trailing zeros trimmed
    function _decimal(uint256 v, uint8 decimals) internal pure returns (string memory) {
        uint256 unit = 10 ** decimals;
        uint256 whole = v / unit;
        uint256 frac = decimals > 6 ? (v % unit) / 10 ** (decimals - 6) : (v % unit) * 10 ** (6 - decimals);
        if (frac == 0) return whole.toString();
        bytes memory f = bytes(frac.toString());
        bytes memory pad = new bytes(6 - f.length);
        for (uint256 i; i < pad.length; ++i) pad[i] = "0";
        bytes memory fr = abi.encodePacked(pad, f);
        uint256 end = fr.length;
        while (end > 0 && fr[end - 1] == "0") --end;
        bytes memory trimmed = new bytes(end);
        for (uint256 i; i < end; ++i) trimmed[i] = fr[i];
        return string.concat(whole.toString(), ".", string(trimmed));
    }

    function _attr(string memory t, string memory v, bool comma) internal pure returns (bytes memory) {
        return abi.encodePacked(
            comma ? "," : "", '{"trait_type":"', LibString.escapeJSON(t), '","value":"', LibString.escapeJSON(v), '"}'
        );
    }
}

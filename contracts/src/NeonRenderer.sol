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
///  - the basket tickers are read from the Stock Token contracts themselves.
/// No IPFS, no server. This contract has no owner and no storage besides immutables.
contract NeonRenderer {
    using DynamicBufferLib for DynamicBufferLib.DynamicBuffer;
    using LibString for uint256;

    NeonFaces public immutable faces;
    NeonSeeder public immutable seeder;
    NeonArt public immutable art;
    address public immutable placeholder; // SSTORE2 pointer of the pre-reveal record
    address private immutable _siteURL; // SSTORE2 pointer of the external URL prefix

    uint256 private constant BG = 5;
    uint256 private constant PLACEHOLDER_ART_ID = 5555;

    constructor(NeonFaces faces_, NeonSeeder seeder_, NeonArt art_, bytes memory placeholderRecord, string memory siteURL_)
    {
        faces = faces_;
        seeder = seeder_;
        art = art_;
        placeholder = SSTORE2.write(placeholderRecord);
        _siteURL = SSTORE2.write(bytes(siteURL_));
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

        DynamicBufferLib.DynamicBuffer memory j;
        j.p('{"name":"NEONFACES #', bytes(tokenId.toString()), '","description":"They don\'t blink. Face #');
        j.p(bytes(tokenId.toString()), " is an account: ", bytes(LibString.toHexStringChecksummed(s.account)));
        j.p(
            ". Whatever it holds travels with it. Stock Tokens give economic exposure only, not legal ownership of the ",
            "underlying shares, and are not available to US persons. Art and metadata are fully on-chain.",
            '","image":"data:image/svg+xml;base64,'
        );
        j.p(bytes(Base64.encode(bytes(renderSVG(revealed ? artId : PLACEHOLDER_ART_ID, rec)))));
        j.p('","external_url":"', bytes(siteURL()), "face/", bytes(tokenId.toString()));
        j.p('","account":"', bytes(LibString.toHexStringChecksummed(s.account)), '","attributes":[');
        j.p(_attr("Stare", _tierName(s.tier), false));
        if (revealed) {
            (string[10] memory names, string[10] memory values) = _traits(rec);
            for (uint256 i; i < 10; ++i) {
                j.p(_attr(names[i], values[i], true));
            }
        } else {
            j.p(_attr("Status", "Unrevealed", true));
        }
        j.p(_attr("Seed", _basketLabel(s), true));
        j.p(_attr("Seed Status", s.funded ? "Funded" : (s.activated ? "Pending" : "Inactive"), true));
        j.p(_holdings(s));
        j.p(_unblinking(tokenId));
        if (revealed) j.p(',{"trait_type":"Art ID","display_type":"number","value":', bytes(artId.toString()), "}");
        j.p("]}");
        return string.concat("data:application/json;base64,", Base64.encode(j.data));
    }

    /// @notice Raw SVG of a token (for sites and agents).
    function svgOf(uint256 tokenId) external view returns (string memory) {
        (bool revealed, uint256 artId, bytes memory rec) = _artOf(tokenId);
        return renderSVG(revealed ? artId : PLACEHOLDER_ART_ID, rec);
    }

    /// @notice Collection metadata (ERC-7572 contractURI), on-chain.
    function contractURI() external view returns (string memory) {
        (address receiver, uint256 fee) = faces.royaltyInfo(1, 10_000);
        DynamicBufferLib.DynamicBuffer memory j;
        j.p(
            '{"name":"NEONFACES","description":"They don\'t blink. 5555 close-up faces on Robinhood Chain. ',
            "Every Face is an account (ERC-6551) seeded with Stock Tokens. Art and metadata fully on-chain.",
            '","image":"data:image/svg+xml;base64,'
        );
        j.p(bytes(Base64.encode(bytes(renderSVG(PLACEHOLDER_ART_ID, SSTORE2.read(placeholder))))));
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
    function renderSVG(uint256 artId, bytes memory rec) public pure returns (string memory) {
        uint256 g = uint8(rec[0]);
        string[8] memory pal = _palette(uint8(rec[3])); // byte 3 = Neon trait
        bytes memory gs = bytes(g.toString());

        DynamicBufferLib.DynamicBuffer memory out;
        out.p('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ', gs, " ", gs);
        out.p('" width="1200" height="1200" shape-rendering="crispEdges"><rect width="', gs, '" height="', gs);
        out.p('" fill="', bytes(pal[BG]), '"/>');

        DynamicBufferLib.DynamicBuffer[8] memory paths;
        uint256 pos;
        for (uint256 k = 11; k < rec.length; ++k) {
            uint256 b = uint8(rec[k]);
            uint256 c = b >> 5;
            uint256 n = (b & 31) + 1;
            while (n > 0) {
                uint256 x = pos % g;
                uint256 seg = n < g - x ? n : g - x;
                if (c != BG) _run(paths[c], x, pos / g, seg);
                pos += seg;
                n -= seg;
            }
        }
        for (uint256 c; c < 8; ++c) {
            if (c == BG || paths[c].data.length == 0) continue;
            out.p('<path fill="', bytes(pal[c]), '" d="', paths[c].data, '"/>');
        }

        uint256 grain = uint8(rec[5]); // byte 5 = Grain trait
        if (grain == 1) _dusty(out, artId, g);
        else if (grain == 2) _scan(out, artId, g, gs);
        out.p("</svg>");
        return out.s();
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
    function _traits(bytes memory rec) internal pure returns (string[10] memory n, string[10] memory v) {
        n = ["Crop", "Density", "Neon", "Edge", "Grain", "Light", "Expression", "Accessory", "Block", "Anomaly"];
        uint256 i0 = uint8(rec[1]);
        v[0] = ["Eye", "Nose", "Brow", "Cheek", "Temple", "Mouth", "Profile-edge"][i0];
        v[1] = ["Sparse", "Mid", "Heavy"][uint8(rec[2])];
        v[2] = ["Standard", "Deep", "Hot"][uint8(rec[3])];
        v[3] = ["Stair-step", "Hard cut", "Bleed dither"][uint8(rec[4])];
        v[4] = ["Clean print", "Dusty", "Heavy scan"][uint8(rec[5])];
        v[5] = ["Left", "Right", "Top"][uint8(rec[6])];
        v[6] = ["Flat", "Squint", "Glare", "Wide", "Tense"][uint8(rec[7])];
        v[7] = ["None", "Mole", "Scar", "Stud", "Tape", "Visor"][uint8(rec[8])];
        v[8] = ["Standard", "Fine", "Coarse"][uint8(rec[9])];
        v[9] = ["None", "Dead pixel", "Inverted blocks", "Extra-wide crop", "Double-eye fragment"][uint8(rec[10])];
    }

    function _tierName(uint8 tier) internal pure returns (string memory) {
        if (tier == 1) return "Glance";
        if (tier == 2) return "Watch";
        if (tier == 3) return "Heavy Stare";
        return "Unassigned";
    }

    function _basketLabel(NeonSeeder.SeedView memory s) internal view returns (string memory label) {
        if (s.legs.length == 0) return s.activated ? "Pending" : "None";
        for (uint256 i; i < s.legs.length; ++i) {
            string memory sym;
            try IERC20Metadata(s.legs[i].token).symbol() returns (string memory x) {
                sym = x;
            } catch {
                sym = "?";
            }
            label = i == 0 ? sym : string.concat(label, " / ", sym);
        }
    }

    /// @dev Live balances of the seed tokens inside the Face account, e.g. {"trait_type":"Holds TSLA","value":"0.003"}
    function _holdings(NeonSeeder.SeedView memory s) internal view returns (bytes memory out) {
        for (uint256 i; i < s.legs.length; ++i) {
            address t = s.legs[i].token;
            (bool ok1, bytes memory rb) = t.staticcall(abi.encodeCall(IERC20.balanceOf, (s.account)));
            (bool ok2, bytes memory rd) = t.staticcall(abi.encodeCall(IERC20Metadata.decimals, ()));
            if (!ok1 || !ok2 || rb.length < 32 || rd.length < 32) continue;
            string memory sym;
            try IERC20Metadata(t).symbol() returns (string memory x) {
                sym = x;
            } catch {
                continue;
            }
            out = abi.encodePacked(
                out, _attr(string.concat("Holds ", sym), _decimal(abi.decode(rb, (uint256)), abi.decode(rd, (uint8))), true)
            );
        }
    }

    /// @dev "Unblinking": days the current holder has kept the Face + the date its eyes opened.
    function _unblinking(uint256 tokenId) internal view returns (bytes memory) {
        uint256 since = faces.heldSince(tokenId);
        if (since == 0) return "";
        return abi.encodePacked(
            ',{"trait_type":"Unblinking (days)","display_type":"number","value":',
            ((block.timestamp - since) / 1 days).toString(),
            '},{"trait_type":"Eyes open since","display_type":"date","value":',
            since.toString(),
            "}"
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
            comma ? "," : "", '{"trait_type":"', t, '","value":"', LibString.escapeJSON(v), '"}'
        );
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {Base64} from "solady/utils/Base64.sol";
import {LibString} from "solady/utils/LibString.sol";
import {NeonArt} from "../src/NeonArt.sol";
import {NeonRenderer} from "../src/NeonRenderer.sol";
import {NeonFaces} from "../src/NeonFaces.sol";
import {NeonSeeder} from "../src/NeonSeeder.sol";
import {MockStockToken} from "./mocks/MockStockToken.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";

/// @notice Fully on-chain art: storage, provenance seal, byte-exact SVG, JSON metadata.
contract OnChainTest is Base {
    using stdJson for string;

    NeonArt artStore;
    NeonRenderer renderer;
    string fixtures;

    function setUp() public override {
        super.setUp();
        fixtures = vm.readFile("test/fixtures/svg-samples.json");
        artStore = new NeonArt(faces, admin);
        bytes memory ph = fixtures.readBytes("[3].record");
        address[] memory watch = new address[](1);
        watch[0] = address(spy);
        renderer = new NeonRenderer(faces, seeder, artStore, ph, "https://neonfaces.xyz/", watch);
        bytes32 artistRole = artStore.ARTIST_ROLE();
        vm.startPrank(admin);
        artStore.grantRole(artistRole, admin);
        faces.setRenderer(address(renderer));
        vm.stopPrank();
    }

    // ---- byte-exact equality with the Python generator ----------------------
    function test_SVG_MatchesPythonMirror() public view {
        for (uint256 i; i < 4; ++i) {
            string memory k = string.concat("[", vm.toString(i), "]");
            uint256 artId = fixtures.readUint(string.concat(k, ".artId"));
            bytes memory rec = fixtures.readBytes(string.concat(k, ".record"));
            string memory expected = fixtures.readString(string.concat(k, ".svg"));
            assertEq(renderer.renderSVG(artId, rec, 0), expected);
        }
    }

    function test_SVG_SetMatchesPythonMirror() public view {
        string memory f = vm.readFile("test/fixtures/svg-set-sample.json");
        bytes[] memory recs = new bytes[](4);
        for (uint256 q; q < 4; ++q) recs[q] = f.readBytes(string.concat(".records[", vm.toString(q), "]"));
        assertEq(renderer.renderSetSVG(f.readUint(".set"), recs, 0), f.readString(".svg"));
        for (uint8 g = 1; g <= 3; ++g) {
            string memory key = string.concat(".gaze", vm.toString(g));
            assertEq(renderer.renderSetSVG(f.readUint(".set"), recs, g), f.readString(key), "gaze mirrors Python");
        }
    }

    // ---- storage + provenance seal --------------------------------------------
    function _fakeChunks(uint256 n, bytes memory rec) internal pure returns (bytes[] memory chunks) {
        // chunk = 32 x uint16 offsets + 32 identical records (just for storage mechanics)
        chunks = new bytes[](n);
        for (uint256 c; c < n; ++c) {
            uint256 count = c == 173 ? 5555 - 173 * 32 : 32;
            bytes memory head;
            bytes memory body;
            for (uint256 i; i < count; ++i) {
                head = abi.encodePacked(head, uint16(2 * count + i * rec.length));
                body = abi.encodePacked(body, rec);
            }
            chunks[c] = abi.encodePacked(head, body);
        }
    }

    /// @dev a valid 20x20 record: all neon field (12 runs of 32 + 1 run of 16), default traits
    function _tinyRecord() internal pure returns (bytes memory r) {
        r = new bytes(25);
        r[0] = bytes1(uint8(20));
        for (uint256 i = 12; i < 24; ++i) r[i] = bytes1(uint8((5 << 5) | 31));
        r[24] = bytes1(uint8((5 << 5) | 15));
    }

    function _uploadAll(bytes memory rec) internal returns (bytes32 h) {
        bytes[] memory all = _fakeChunks(174, rec);
        for (uint256 c; c < 174; ++c) h = keccak256(abi.encodePacked(h, all[c]));
        vm.startPrank(admin);
        faces.setProvenanceHash(h);
        for (uint256 s; s < 174; s += 29) {
            bytes[] memory batch = new bytes[](29);
            for (uint256 i; i < 29; ++i) batch[i] = all[s + i];
            artStore.appendChunks(batch);
        }
        vm.stopPrank();
    }

    function test_Art_SealRequiresProvenanceMatch() public {
        bytes memory rec = _tinyRecord();
        bytes32 h = _uploadAll(rec);
        assertEq(artStore.runningHash(), h);
        vm.prank(admin);
        artStore.seal();
        assertTrue(artStore.isSealed());
        assertEq(artStore.artData(0), rec);
        assertEq(artStore.artData(5554), rec);
        assertEq(artStore.artData(31), rec);
        assertEq(artStore.artData(32), rec);

        bytes[] memory more = new bytes[](1);
        more[0] = hex"00";
        vm.prank(admin);
        vm.expectRevert(NeonArt.ArtIsSealed.selector);
        artStore.appendChunks(more);
    }

    function test_Art_SealRejectsTamperedArt() public {
        bytes memory rec = _tinyRecord();
        bytes[] memory all = _fakeChunks(174, rec);
        vm.startPrank(admin);
        faces.setProvenanceHash(keccak256("the art we promised"));
        for (uint256 s; s < 174; s += 29) {
            bytes[] memory batch = new bytes[](29);
            for (uint256 i; i < 29; ++i) batch[i] = all[s + i];
            artStore.appendChunks(batch);
        }
        vm.expectRevert();
        artStore.seal();
        vm.stopPrank();
    }

    function test_Art_OnlyArtist() public {
        bytes[] memory more = new bytes[](1);
        more[0] = hex"00";
        vm.prank(alice);
        vm.expectRevert();
        artStore.appendChunks(more);
    }

    // ---- tokenURI end to end ------------------------------------------------------
    function _json(string memory uri) internal pure returns (string memory) {
        bytes memory b = bytes(uri);
        bytes memory payload = new bytes(b.length - 29);
        for (uint256 i; i < payload.length; ++i) payload[i] = b[i + 29]; // strip "data:application/json;base64,"
        return string(Base64.decode(string(payload)));
    }

    function test_TokenURI_UnrevealedThenRevealedOnChain() public {
        bytes memory rec = _tinyRecord();
        _uploadAll(rec);
        vm.prank(admin);
        artStore.seal();

        _openPublic();
        _mintPublic(alice, 2);

        string memory pre = _json(faces.tokenURI(1));
        assertTrue(LibString.contains(pre, '"name":"NEONFACES #1"'));
        assertTrue(LibString.contains(pre, '"value":"Unrevealed"'));
        assertTrue(LibString.contains(pre, '"trait_type":"Seed Status","value":"Funded"'));
        assertTrue(LibString.contains(pre, LibString.toHexStringChecksummed(seeder.accountOf(1))));

        vm.prank(admin);
        faces.requestReveal();
        vm.roll(block.number + 6);
        faces.reveal();

        string memory post = _json(faces.tokenURI(1));
        assertTrue(LibString.contains(post, '"trait_type":"Crop"'));
        assertTrue(LibString.contains(post, '"trait_type":"Anomaly"'));
        assertTrue(LibString.contains(post, '"trait_type":"Art ID"'));
        assertFalse(LibString.contains(post, "Unrevealed"));
        // the basket tickers come from the token contracts
        assertTrue(
            LibString.contains(post, '"value":"TSLA"') || LibString.contains(post, '"value":"NVDA"')
                || LibString.contains(post, "NVDA / USDG") || LibString.contains(post, "SPY / TSLA")
        );
        // image is the on-chain SVG of the assigned art
        uint256 artId = seeder.artIdOf(1);
        string memory svg = renderer.renderSVG(artId, rec, 0);
        assertTrue(LibString.contains(post, Base64.encode(bytes(svg))));
        assertEq(renderer.svgOf(1), svg);
    }

    /// What a marketplace reads for a set: the anchor shows the whole face and names the pieces it holds, the
    /// pieces inside say where they are; "Set" and "Holds" are numbers (kept out of trait filters and rarity).
    function test_Metadata_AssembledSetForMarketplaces() public {
        _uploadAll(_tinyRecord());
        vm.prank(admin);
        artStore.seal();
        _allowTestAsSeaDrop();
        faces.mintSeaDrop(alice, 120);
        _reveal();
        uint256[4] memory m;
        uint256 setId;
        for (uint256 id = 1; setId == 0; ++id) (setId,, m) = seeder.setOf(id);
        address acc = seeder.accountOf(m[0]);
        vm.startPrank(alice);
        for (uint256 q = 1; q < 4; ++q) faces.transferFrom(alice, acc, m[q]);
        vm.stopPrank();

        string memory a = _json(faces.tokenURI(m[0]));
        _checkJson(a);
        assertTrue(LibString.contains(a, string.concat('"trait_type":"Set","display_type":"number","value":', vm.toString(setId), "}")));
        assertTrue(LibString.contains(a, '"trait_type":"Set Status","value":"Assembled"'));
        assertTrue(LibString.contains(a, string.concat("It holds the other three pieces of set ", vm.toString(setId), " (#", vm.toString(m[1]), ", #", vm.toString(m[2]), ", #", vm.toString(m[3]), ")")));
        assertTrue(LibString.contains(a, '","display_type":"number","value":'));
        assertFalse(LibString.contains(a, '"trait_type":"Holds SPY","value":"'), "balances are not strings");
        assertEq(renderer.svgOf(m[0]), renderer.renderSetSVG(setId, _fourRecords(), 0), "whole face");

        string memory p = _json(faces.tokenURI(m[1]));
        _checkJson(p);
        assertTrue(LibString.contains(p, '"trait_type":"Set Status","value":"Inside Another Piece"'));
        assertTrue(LibString.contains(p, string.concat("It sits inside Face #", vm.toString(m[0]), ", a piece of the same set.")));
        assertFalse(LibString.contains(p, "Inside #"), "ids stay out of the trait values");

        // fused: the status, the date, a neon frame around the whole face
        vm.prank(alice);
        seeder.fuse(m[0]);
        string memory f = _json(faces.tokenURI(m[0]));
        _checkJson(f);
        assertTrue(LibString.contains(f, '"trait_type":"Set Status","value":"Fused"'));
        assertTrue(LibString.contains(f, '"trait_type":"Fused Since","display_type":"date"'));
        assertTrue(LibString.contains(f, "Fused for good"));
        string memory svg = renderer.svgOf(m[0]);
        assertTrue(LibString.contains(svg, 'fill="none" stroke="#CCFF00"/></svg>'));
        assertTrue(LibString.startsWith(svg, "<svg"));
    }

    /// @dev forge's JSON parser refuses decimal numbers, so the check is structural: no string-quoted numbers
    /// after a number display_type, balanced braces and brackets, nothing after the closing brace.
    function _checkJson(string memory j) internal pure {
        bytes memory b = bytes(j);
        int256 depth;
        bool inString;
        for (uint256 i; i < b.length; ++i) {
            if (inString) {
                if (b[i] == "\\") ++i;
                else if (b[i] == '"') inString = false;
                continue;
            }
            if (b[i] == '"') inString = true;
            else if (b[i] == "{" || b[i] == "[") ++depth;
            else if (b[i] == "}" || b[i] == "]") --depth;
            assertTrue(depth >= 0, "unbalanced");
            if (depth == 0) assertEq(i, b.length - 1, "trailing data");
        }
        assertEq(depth, 0, "unbalanced");
        assertFalse(LibString.contains(j, '"display_type":"number","value":"'), "number traits are numbers");
    }

    function _fourRecords() internal pure returns (bytes[] memory recs) {
        recs = new bytes[](4);
        for (uint256 q; q < 4; ++q) recs[q] = _tinyRecord();
    }

    function test_Metadata_UnblinkingAndLiveHoldings() public {
        _openPublic();
        _mintPublic(alice, 1);
        vm.warp(block.timestamp + 10 days);
        string memory j = _json(faces.tokenURI(1));
        assertTrue(LibString.contains(j, '"trait_type":"Unblinking Days","display_type":"number","value":10}'));
        assertTrue(LibString.contains(j, '"trait_type":"Eyes Open Since","display_type":"date"'));
        assertTrue(LibString.contains(j, '"trait_type":"Holds '));
        assertEq(faces.unblinkingFor(1), 10 days);

        // selling the Face resets the clock
        vm.prank(alice);
        faces.transferFrom(alice, bob, 1);
        assertEq(faces.unblinkingFor(1), 0);
        j = _json(faces.tokenURI(1));
        assertTrue(LibString.contains(j, '"trait_type":"Unblinking Days","display_type":"number","value":0}'));
    }

    function test_Metadata_GazeBloomsWithTimeAndResetsOnSale() public {
        _openPublic();
        _mintPublic(alice, 1);
        assertEq(renderer.gazeOf(1), 0);
        assertFalse(LibString.contains(_json(faces.tokenURI(1)), '"Gaze"'));
        assertFalse(LibString.contains(renderer.svgOf(1), 'filter="url(#b)"'));

        string[3] memory names = ["Steady", "Fixed", "Piercing"];
        uint256[3] memory days_ = [uint256(30), 90, 365];
        uint256 start = block.timestamp;
        for (uint256 i; i < 3; ++i) {
            vm.warp(start + days_[i] * 1 days);
            assertEq(renderer.gazeOf(1), i + 1);
            string memory j = _json(faces.tokenURI(1));
            assertTrue(LibString.contains(j, string.concat('"trait_type":"Gaze","value":"', names[i], '"')));
            assertTrue(LibString.contains(renderer.svgOf(1), 'filter="url(#b)"'), "the neon blooms");
        }
        vm.prank(alice);
        faces.transferFrom(alice, bob, 1);
        assertEq(renderer.gazeOf(1), 0, "a sale resets the gaze");
        assertFalse(LibString.contains(renderer.svgOf(1), 'filter="url(#b)"'));
    }

    function test_Metadata_DailyRefreshIsPermissionless() public {
        vm.warp(10 days);
        vm.expectEmit(address(faces));
        emit IERC4906.BatchMetadataUpdate(1, 5555);
        vm.prank(carol); // anyone (the keeper does it daily)
        faces.refreshMetadata();
        vm.expectRevert(NeonFaces.RefreshTooSoon.selector);
        faces.refreshMetadata();
        vm.warp(block.timestamp + 1 days);
        faces.refreshMetadata();
    }

    function test_Metadata_HoldingsAreLive() public {
        _openPublic();
        _mintPublic(alice, 1);
        NeonSeeder.SeedView memory s = seeder.seedOf(1);
        // top up the account with more of the first leg: the trait follows the real balance
        MockStockToken(s.legs[0].token).mint(s.account, 1e18);
        string memory sym = MockStockToken(s.legs[0].token).symbol();
        string memory j = _json(faces.tokenURI(1));
        uint256 bal = MockStockToken(s.legs[0].token).balanceOf(s.account);
        assertEq(bal, 1e18 + s.legs[0].amount);
        assertTrue(LibString.contains(j, string.concat('"trait_type":"Holds ', sym, '","display_type":"number","value":1.')));
    }

    function test_Metadata_StareUpgradeAndLockAfterReveal() public {
        bytes memory rec = _tinyRecord();
        _uploadAll(rec);
        artStore.seal();
        _openPublic(100);
        for (uint256 i; i < 4; ++i) _mintPublic(alice, 10);

        string memory pre = _json(faces.tokenURI(1));
        assertTrue(LibString.contains(pre, '"trait_type":"Stare","value":"Unrevealed"'));

        _reveal();
        uint256 id = 1;
        while (seeder.tierOf(id) < 2) ++id; // first Watch / Heavy Stare Face
        string memory j = _json(faces.tokenURI(id));
        assertTrue(LibString.contains(j, '"trait_type":"Stare Upgrade","value":"Pending"'));
        assertFalse(LibString.contains(j, '"value":"Unrevealed"'));

        seeder.upgrade(id);
        NeonFaceAccount acc = NeonFaceAccount(payable(seeder.accountOf(id)));
        vm.prank(alice);
        acc.lock(uint64(block.timestamp + 2 days));
        j = _json(faces.tokenURI(id));
        assertFalse(LibString.contains(j, '"Stare Upgrade","value":"Pending"'));
        assertTrue(LibString.contains(j, '"trait_type":"Locked Until","display_type":"date"'));
        assertTrue(LibString.contains(j, seeder.tierOf(id) == 2 ? '"value":"Watch"' : '"value":"Heavy Stare"'));
    }

    function test_Metadata_ShowsTradedTokensWhenHeld() public {
        _openPublic();
        _mintPublic(alice, 1);
        string memory j = _json(faces.tokenURI(1));
        assertFalse(LibString.contains(j, '"Holds SPY"'), "not shown while not held");
        spy.mint(seeder.accountOf(1), 2e18); // e.g. bought by the Face's agent
        j = _json(faces.tokenURI(1));
        assertTrue(LibString.contains(j, '"trait_type":"Holds SPY","display_type":"number","value":2}'));
    }

    function test_ContractURI_OnChain() public view {
        string memory c = _json(faces.contractURI());
        assertTrue(LibString.contains(c, '"name":"NEONFACES"'));
        assertTrue(LibString.contains(c, '"seller_fee_basis_points":500'));
        assertTrue(LibString.contains(c, "data:image/svg+xml;base64,"));
    }

    function test_TokenURI_GasFitsInRpcLimits() public {
        bytes memory rec = _tinyRecord();
        _uploadAll(rec);
        vm.prank(admin);
        artStore.seal();
        _openPublic();
        _mintPublic(alice, 1);
        vm.prank(admin);
        faces.requestReveal();
        vm.roll(block.number + 6);
        faces.reveal();
        uint256 g = gasleft();
        faces.tokenURI(1);
        uint256 used = g - gasleft();
        emit log_named_uint("tokenURI gas", used);
        assertLt(used, 30_000_000);
    }
}

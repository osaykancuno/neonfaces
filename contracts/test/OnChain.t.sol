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
import {NeonMinter} from "../src/NeonMinter.sol";
import {NeonFaceAccount} from "../src/NeonFaceAccount.sol";

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
        renderer = new NeonRenderer(faces, seeder, artStore, ph, "https://neonfaces.xyz/");
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
            assertEq(renderer.renderSVG(artId, rec), expected);
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
        r = new bytes(24);
        r[0] = bytes1(uint8(20));
        for (uint256 i = 11; i < 23; ++i) r[i] = bytes1(uint8((5 << 5) | 31));
        r[23] = bytes1(uint8((5 << 5) | 15));
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
        string memory svg = renderer.renderSVG(artId, rec);
        assertTrue(LibString.contains(post, Base64.encode(bytes(svg))));
        assertEq(renderer.svgOf(1), svg);
    }

    function test_Metadata_UnblinkingAndLiveHoldings() public {
        _openPublic();
        _mintPublic(alice, 1);
        vm.warp(block.timestamp + 10 days);
        string memory j = _json(faces.tokenURI(1));
        assertTrue(LibString.contains(j, '"trait_type":"Unblinking (days)","display_type":"number","value":10}'));
        assertTrue(LibString.contains(j, '"trait_type":"Eyes open since","display_type":"date"'));
        assertTrue(LibString.contains(j, '"trait_type":"Holds '));
        assertEq(faces.unblinkingFor(1), 10 days);

        // selling the Face resets the clock
        vm.prank(alice);
        faces.transferFrom(alice, bob, 1);
        assertEq(faces.unblinkingFor(1), 0);
        j = _json(faces.tokenURI(1));
        assertTrue(LibString.contains(j, '"trait_type":"Unblinking (days)","display_type":"number","value":0}'));
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
        assertTrue(LibString.contains(j, string.concat('"trait_type":"Holds ', sym, '","value":"1.')));
    }

    function test_Metadata_StareUpgradeAndLockAfterReveal() public {
        bytes memory rec = _tinyRecord();
        _uploadAll(rec);
        artStore.seal();
        _openPublic();
        vm.prank(admin);
        minter.configurePhase(NeonMinter.Phase.Public, PUBLIC_PRICE, 100, 0, bytes32(0));
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
        assertTrue(LibString.contains(j, '"trait_type":"Locked until","display_type":"date"'));
        assertTrue(LibString.contains(j, seeder.tierOf(id) == 2 ? '"value":"Watch"' : '"value":"Heavy Stare"'));
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

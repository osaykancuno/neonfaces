// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {NeonArt} from "../src/NeonArt.sol";

/// @notice Stores the 5555 Faces on-chain (SSTORE2) and seals them against the provenance hash.
/// Resumable: starts from `art.chunkCount()`, so it can simply be re-run after any interruption.
///
///   forge script script/UploadArt.s.sol --rpc-url robinhood --broadcast --slow
///
/// Env: ART (NeonArt address; default from deployments/<chainid>.json), BATCH (chunks per tx, default 12)
contract UploadArt is Script {
    function run() external {
        address artAddr = vm.envOr("ART", address(0));
        if (artAddr == address(0)) {
            string memory dep = vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
            artAddr = vm.parseJsonAddress(dep, ".art");
        }
        NeonArt art = NeonArt(artAddr);
        uint256 batch = vm.envOr("BATCH", uint256(12));

        string memory json = vm.readFile("../art/output/onchain/chunks.json");
        bytes[] memory chunks = vm.parseJsonBytesArray(json, "");
        require(chunks.length == art.CHUNK_COUNT(), "chunks.json does not match CHUNK_COUNT");

        uint256 done = art.chunkCount();
        console2.log("chunks on-chain", done, "/", chunks.length);

        vm.startBroadcast();
        while (done < chunks.length) {
            uint256 n = chunks.length - done < batch ? chunks.length - done : batch;
            bytes[] memory part = new bytes[](n);
            for (uint256 i; i < n; ++i) part[i] = chunks[done + i];
            art.appendChunks(part);
            done += n;
            console2.log("uploaded", done);
        }
        if (!art.isSealed()) art.seal(); // reverts unless the art matches the pre-mint provenance
        vm.stopBroadcast();
        console2.log("sealed. running hash:");
        console2.logBytes32(art.runningHash());
    }
}

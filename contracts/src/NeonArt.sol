// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SSTORE2} from "solady/utils/SSTORE2.sol";
import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {NeonFaces} from "./NeonFaces.sol";

/// @title NeonArt — the 5555 Faces, stored on-chain
/// @notice Every Face is a pixel record (grid size, 10 trait bytes, RLE pixels) stored in SSTORE2
/// chunks of 32 records. Chunks are appended in order and hashed as they arrive:
///     h(k+1) = keccak256(h(k) || chunk(k))
/// `seal()` only succeeds if the final hash equals the provenance hash that NeonFaces committed
/// BEFORE the first mint — the art on-chain is provably the art that was promised. After sealing,
/// nothing can be added or changed, by anyone, ever.
contract NeonArt is AccessControlDefaultAdminRules {
    bytes32 public constant ARTIST_ROLE = keccak256("ARTIST_ROLE");
    uint256 public constant ART_COUNT = 5555;
    uint256 public constant PER_CHUNK = 32;
    uint256 public constant CHUNK_COUNT = (ART_COUNT + PER_CHUNK - 1) / PER_CHUNK; // 174

    NeonFaces public immutable faces;

    address[] public chunks;
    bytes32 public runningHash;
    bool public isSealed;

    event ChunksAppended(uint256 firstChunk, uint256 count, bytes32 runningHash);
    event ArtSealed(bytes32 provenanceHash);

    error ArtIsSealed();
    error ArtNotSealed();
    error TooManyChunks();
    error IncompleteArt();
    error ProvenanceMismatch(bytes32 expected, bytes32 actual);
    error BadArtId();

    constructor(NeonFaces faces_, address admin) AccessControlDefaultAdminRules(0, admin) {
        faces = faces_;
    }

    function appendChunks(bytes[] calldata data) external onlyRole(ARTIST_ROLE) {
        if (isSealed) revert ArtIsSealed();
        if (chunks.length + data.length > CHUNK_COUNT) revert TooManyChunks();
        uint256 first = chunks.length;
        bytes32 h = runningHash;
        for (uint256 i; i < data.length; ++i) {
            chunks.push(SSTORE2.write(data[i]));
            h = keccak256(abi.encodePacked(h, data[i]));
        }
        runningHash = h;
        emit ChunksAppended(first, data.length, h);
    }

    /// @notice Lock the art forever. Permissionless: it only succeeds with the complete set AND an exact
    /// match with the provenance committed before mint, so nobody needs to be trusted to call it.
    function seal() external {
        if (isSealed) revert ArtIsSealed();
        if (chunks.length != CHUNK_COUNT) revert IncompleteArt();
        bytes32 expected = faces.provenanceHash();
        if (runningHash != expected) revert ProvenanceMismatch(expected, runningHash);
        isSealed = true;
        emit ArtSealed(expected);
    }

    /// @notice Start over (e.g. a botched upload). Only before sealing — sealing re-checks provenance anyway.
    function resetUnsealed() external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (isSealed) revert ArtIsSealed();
        delete chunks;
        runningHash = bytes32(0);
    }

    function chunkCount() external view returns (uint256) {
        return chunks.length;
    }

    /// @notice Raw record of art piece `artId` (0..5554).
    function artData(uint256 artId) public view returns (bytes memory) {
        if (artId >= ART_COUNT) revert BadArtId();
        address ptr = chunks[artId / PER_CHUNK];
        uint256 i = artId % PER_CHUNK;
        bytes memory head = SSTORE2.read(ptr, 0, 2);
        uint256 n = (uint256(uint8(head[0])) << 8 | uint8(head[1])) / 2;
        bytes memory offs = SSTORE2.read(ptr, 2 * i, 2 * i + 4);
        uint256 start = uint256(uint8(offs[0])) << 8 | uint8(offs[1]);
        uint256 end = i + 1 < n ? (uint256(uint8(offs[2])) << 8 | uint8(offs[3])) : type(uint256).max;
        return SSTORE2.read(ptr, start, end);
    }
}

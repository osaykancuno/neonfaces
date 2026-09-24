// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {ChainEntropy} from "./lib/ChainEntropy.sol";

interface ITokenURIRenderer {
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function contractURI() external view returns (string memory);
}

///  ███╗   ██╗███████╗ ██████╗ ███╗   ██╗███████╗ █████╗  ██████╗███████╗███████╗
///  ████╗  ██║██╔════╝██╔═══██╗████╗  ██║██╔════╝██╔══██╗██╔════╝██╔════╝██╔════╝
///  ██╔██╗ ██║█████╗  ██║   ██║██╔██╗ ██║█████╗  ███████║██║     █████╗  ███████╗
///  ██║╚██╗██║██╔══╝  ██║   ██║██║╚██╗██║██╔══╝  ██╔══██║██║     ██╔══╝  ╚════██║
///  ██║ ╚████║███████╗╚██████╔╝██║ ╚████║██║     ██║  ██║╚██████╗███████╗███████║
///  ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝     ╚═╝  ╚═╝ ╚═════╝╚══════╝╚══════╝
///
/// @title NEONFACES — They don't blink.
/// @notice 5555 close-up faces on Robinhood Chain. Every Face is an account (ERC-6551).
/// @dev Design goals: small audit surface, hard caps in bytecode, no upgradeability,
/// no transfer restrictions (no admin key over the secondary market).
///
/// Roles
///  - DEFAULT_ADMIN_ROLE (multisig, 2-step transfer with delay): royalties, roles, team mint, provenance.
///  - MINTER_ROLE: the NeonMinter sale contract. Can only mint inside the public allocation.
///  - PAUSER_ROLE: can pause / unpause *minting* (never transfers).
///  - METADATA_ROLE: renderer, reveal request, fallback URIs — until metadata is frozen.
///
/// Metadata is fully on-chain: `renderer` (NeonRenderer) builds the JSON and the SVG from the pixel
/// records stored in NeonArt. The base-URI path only exists as a fallback when no renderer is set.
contract NeonFaces is ERC721, ERC2981, AccessControlDefaultAdminRules, IERC4906 {
    using Strings for uint256;

    // ---------------------------------------------------------------------
    // Constants (in bytecode, cannot change)
    // ---------------------------------------------------------------------
    uint256 public constant MAX_SUPPLY = 5555;
    uint256 public constant TEAM_CAP = 111;
    uint256 public constant PUBLIC_CAP = MAX_SUPPLY - TEAM_CAP; // 5444
    uint96 public constant MAX_ROYALTY_BPS = 500; // 5%
    uint256 public constant REVEAL_DELAY_BLOCKS = 5;

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant METADATA_ROLE = keccak256("METADATA_ROLE");

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------
    uint256 public totalSupply; // tokens minted (ids 1..totalSupply), there is no burn
    uint256 public publicMinted;
    uint256 public teamMinted;
    bool public mintPaused;

    string private _baseTokenURI;
    string private _unrevealedURI;
    string private _contractURI;
    address public renderer; // optional on-chain renderer (future dynamic "mood"), 0 = baseURI
    bool public metadataFrozen;

    bytes32 public provenanceHash; // keccak running hash of the on-chain art chunks, committed before mint
    uint256 public revealBlock; // L2 block whose hash becomes the reveal seed
    uint256 public revealSeed; // 0 until revealed

    /// @notice "Unblinking": when each Face last changed hands (mint or transfer). The longer a stare
    /// stays with one holder, the longer its eyes have been open. Read by the renderer.
    mapping(uint256 tokenId => uint64) public heldSince;

    // ---------------------------------------------------------------------
    // Events / errors
    // ---------------------------------------------------------------------
    event MintPaused(bool paused);
    event ProvenanceSet(bytes32 provenanceHash);
    event RevealRequested(uint256 revealBlock);
    event Revealed(uint256 revealSeed);
    event RendererSet(address renderer);
    event MetadataFrozen();
    event ContractURIUpdated(); // ERC-7572
    event TeamMint(address indexed to, uint256 firstId, uint256 quantity);

    error ExceedsPublicAllocation();
    error ExceedsTeamAllocation();
    error MintIsPaused();
    error ZeroQuantity();
    error ProvenanceAlreadySet();
    error MintAlreadyStarted();
    error RevealAlreadyDone();
    error RevealNotRequested();
    error RevealTooEarly();
    error RevealBlockExpired();
    error MetadataIsFrozen();
    error RoyaltyTooHigh();

    constructor(
        address admin,
        address royaltyReceiver,
        string memory unrevealedURI_,
        string memory contractURI_
    ) ERC721("NEONFACES", "NEON") AccessControlDefaultAdminRules(2 days, admin) {
        _setDefaultRoyalty(royaltyReceiver, MAX_ROYALTY_BPS);
        _unrevealedURI = unrevealedURI_;
        _contractURI = contractURI_;
    }

    // ---------------------------------------------------------------------
    // Minting
    // ---------------------------------------------------------------------

    /// @notice Mint `quantity` sequential ids to `to`. Only the sale contract.
    /// @return firstId the first id minted (ids are firstId .. firstId + quantity - 1)
    function mint(address to, uint256 quantity) external onlyRole(MINTER_ROLE) returns (uint256 firstId) {
        if (mintPaused) revert MintIsPaused();
        if (publicMinted + quantity > PUBLIC_CAP) revert ExceedsPublicAllocation();
        publicMinted += quantity;
        firstId = _mintBatch(to, quantity);
    }

    /// @notice Team allocation, hard capped at 111 in bytecode.
    /// @dev Team Faces still need `NeonSeeder.activate(id)` to get their account + seed.
    function teamMint(address to, uint256 quantity) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 firstId) {
        if (teamMinted + quantity > TEAM_CAP) revert ExceedsTeamAllocation();
        teamMinted += quantity;
        firstId = _mintBatch(to, quantity);
        emit TeamMint(to, firstId, quantity);
    }

    function _mintBatch(address to, uint256 quantity) private returns (uint256 firstId) {
        if (quantity == 0) revert ZeroQuantity();
        firstId = totalSupply + 1;
        totalSupply += quantity;
        // MAX_SUPPLY is implied: PUBLIC_CAP + TEAM_CAP == MAX_SUPPLY
        for (uint256 i; i < quantity; ++i) {
            _mint(to, firstId + i);
        }
    }

    function setMintPaused(bool paused) external onlyRole(PAUSER_ROLE) {
        mintPaused = paused;
        emit MintPaused(paused);
    }

    /// @dev Records the "Unblinking" clock on every mint / transfer. No restrictions, no hooks for admins.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = super._update(to, tokenId, auth);
        heldSince[tokenId] = uint64(block.timestamp);
    }

    /// @notice Seconds the current holder has kept this Face (0 for nonexistent tokens).
    function unblinkingFor(uint256 tokenId) external view returns (uint256) {
        uint256 since = heldSince[tokenId];
        return since == 0 || _ownerOf(tokenId) == address(0) ? 0 : block.timestamp - since;
    }

    function exists(uint256 tokenId) external view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    // ---------------------------------------------------------------------
    // Provenance + reveal (commit before mint, random offset after)
    // ---------------------------------------------------------------------

    /// @notice Commit the provenance hash of the full art set. Only once and only before mint.
    function setProvenanceHash(bytes32 hash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (provenanceHash != bytes32(0)) revert ProvenanceAlreadySet();
        if (totalSupply != 0) revert MintAlreadyStarted();
        provenanceHash = hash;
        emit ProvenanceSet(hash);
    }

    /// @notice Step 1 of the reveal: pick a future L2 block whose hash will be the seed.
    /// Can be called again only if the previous target block fell out of the 256-block window.
    function requestReveal() external onlyRole(METADATA_ROLE) {
        if (revealSeed != 0) revert RevealAlreadyDone();
        revealBlock = ChainEntropy.blockNumber() + REVEAL_DELAY_BLOCKS;
        emit RevealRequested(revealBlock);
    }

    /// @notice Step 2 of the reveal: anyone can finalize once the target block exists.
    function reveal() external {
        if (revealSeed != 0) revert RevealAlreadyDone();
        uint256 target = revealBlock;
        if (target == 0) revert RevealNotRequested();
        if (ChainEntropy.blockNumber() <= target) revert RevealTooEarly();
        bytes32 h = ChainEntropy.blockHash(target);
        if (h == bytes32(0)) revert RevealBlockExpired();
        uint256 seed = uint256(keccak256(abi.encode(h, provenanceHash, address(this))));
        revealSeed = seed == 0 ? 1 : seed;
        emit Revealed(revealSeed);
        emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    // ---------------------------------------------------------------------
    // Metadata
    // ---------------------------------------------------------------------
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        if (renderer != address(0)) return ITokenURIRenderer(renderer).tokenURI(tokenId);
        if (bytes(_baseTokenURI).length == 0) return _unrevealedURI;
        return string.concat(_baseTokenURI, tokenId.toString());
    }

    /// @notice Collection metadata (ERC-7572). Served on-chain by the renderer when one is set.
    function contractURI() external view returns (string memory) {
        if (renderer != address(0)) {
            try ITokenURIRenderer(renderer).contractURI() returns (string memory uri) {
                return uri;
            } catch {}
        }
        return _contractURI;
    }

    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    modifier notFrozen() {
        if (metadataFrozen) revert MetadataIsFrozen();
        _;
    }

    function setBaseURI(string calldata uri) external onlyRole(METADATA_ROLE) notFrozen {
        _baseTokenURI = uri;
        emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    function setUnrevealedURI(string calldata uri) external onlyRole(METADATA_ROLE) notFrozen {
        _unrevealedURI = uri;
        emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    /// @notice Optional renderer for dynamic metadata (e.g. basket "mood"). 0 disables it.
    function setRenderer(address newRenderer) external onlyRole(METADATA_ROLE) notFrozen {
        renderer = newRenderer;
        emit RendererSet(newRenderer);
        emit BatchMetadataUpdate(1, MAX_SUPPLY);
    }

    /// @notice Ask marketplaces to refresh a range (e.g. after a seed is funded).
    function refreshMetadata(uint256 fromId, uint256 toId) external onlyRole(METADATA_ROLE) {
        emit BatchMetadataUpdate(fromId, toId);
    }

    function setContractURI(string calldata uri) external onlyRole(METADATA_ROLE) {
        _contractURI = uri;
        emit ContractURIUpdated();
    }

    /// @notice Irreversibly freeze token metadata (base URI, unrevealed URI, renderer).
    function freezeMetadata() external onlyRole(DEFAULT_ADMIN_ROLE) notFrozen {
        metadataFrozen = true;
        emit MetadataFrozen();
    }

    // ---------------------------------------------------------------------
    // Royalties (ERC-2981), capped at 5%
    // ---------------------------------------------------------------------
    function setDefaultRoyalty(address receiver, uint96 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        _setDefaultRoyalty(receiver, bps);
    }

    // ---------------------------------------------------------------------
    // ERC-165
    // ---------------------------------------------------------------------
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC2981, AccessControlDefaultAdminRules, IERC165)
        returns (bool)
    {
        return interfaceId == bytes4(0x49064906) // ERC-4906
            || ERC721.supportsInterface(interfaceId) || ERC2981.supportsInterface(interfaceId)
            || AccessControlDefaultAdminRules.supportsInterface(interfaceId);
    }
}

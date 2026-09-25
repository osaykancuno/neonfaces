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
import {
    ISeaDrop,
    INonFungibleSeaDropToken,
    ISeaDropTokenContractMetadata,
    PublicDrop,
    AllowListData,
    TokenGatedDropStage,
    SignedMintValidationParams,
    MultiConfigureStruct,
    RoyaltyInfo as SeaDropRoyaltyInfo
} from "./interfaces/ISeaDrop.sol";

interface ITokenURIRenderer {
    function tokenURI(uint256 tokenId) external view returns (string memory);
    function contractURI() external view returns (string memory);
}

interface INeonSeeder {
    function faces() external view returns (address);
    function activate(uint256 tokenId) external returns (address account);
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
/// Minting happens on OpenSea through SeaDrop (SeaDrop 1.0 token interface, implemented here without
/// ERC721A). SeaDrop checks stage, price, allowlist proof and per-wallet limit, then calls `mintSeaDrop`;
/// this contract mints and gives every Face its ERC-6551 account + base seed in the same transaction.
/// Mint proceeds can only be paid to the immutable `payout` splitter (NeonPayout: 40 / 25 / 20 / 15).
///
/// Roles
///  - DEFAULT_ADMIN_ROLE (multisig, 2-step transfer with delay): royalties, roles, team mint, provenance,
///    which SeaDrop contract may mint, the sale manager.
///  - saleManager: the wallet that runs the drop in OpenSea Studio (`owner()` while set). It can only
///    configure SeaDrop stages: it cannot mint, change the art or the roles, pay proceeds to anyone but
///    NeonPayout, or set a stage fee above MAX_FEE_BPS or without restricted fee recipients. Allowlist
///    Merkle roots (built by Studio) can't be checked here: tools/verify-drop.mjs checks the live config.
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
    uint96 private constant BPS = 10_000;
    /// @notice Highest marketplace fee a SeaDrop stage may carry (OpenSea's drop fee). Stages must also restrict
    /// fee recipients, so a fee can't be pointed at an arbitrary address to route mint money around NeonPayout.
    uint256 public constant MAX_FEE_BPS = 1_000;

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
    /// @notice Minting ends for good when the reveal is requested: nobody can mint once art is knowable.
    bool public mintClosed;
    uint256 public revealRequests;

    /// @notice The only address SeaDrop may pay mint proceeds to (NeonPayout, immutable split).
    address public immutable payout;
    /// @notice Gives every new Face its account and base seed. Set once, before the first mint.
    address public seeder;
    /// @notice Runs the drop in OpenSea Studio; reported as `owner()` while set.
    address public saleManager;
    mapping(address seaDrop => bool) private _allowedSeaDrop;
    address[] private _enumeratedAllowedSeaDrop;
    /// @notice Faces minted through SeaDrop per wallet (SeaDrop enforces per-wallet limits on it).
    mapping(address minter => uint256) public seaDropMinted;

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
    event MintClosed(uint256 totalSupply);
    event SeederSet(address seeder);
    event SaleManagerSet(address saleManager);
    event SeaDropTokenDeployed();
    event AllowedSeaDropUpdated(address[] allowedSeaDrop);

    error ExceedsPublicAllocation();
    error ExceedsTeamAllocation();
    error MintIsPaused();
    error ZeroQuantity();
    error ProvenanceNotSet();
    error MintIsClosed();
    error ProvenanceAlreadySet();
    error MintAlreadyStarted();
    error RevealAlreadyDone();
    error RevealNotRequested();
    error RevealTooEarly();
    error RevealBlockExpired();
    error RevealStillOpen();
    error MetadataIsFrozen();
    error RoyaltyTooHigh();
    error OnlyAllowedSeaDrop();
    error OnlySaleManager();
    error PayoutIsFixed();
    error SupplyIsFixed();
    error SeederNotSet();
    error SeederAlreadySet();
    error SeederMismatch();
    error InvalidConfig();
    error FeeNotAllowed();

    constructor(
        address admin,
        address royaltyReceiver,
        address payout_,
        address seaDrop,
        string memory unrevealedURI_,
        string memory contractURI_
    ) ERC721("NEONFACES", "NEON") AccessControlDefaultAdminRules(2 days, admin) {
        if (payout_ == address(0)) revert PayoutIsFixed();
        payout = payout_;
        _setDefaultRoyalty(royaltyReceiver, MAX_ROYALTY_BPS);
        _unrevealedURI = unrevealedURI_;
        _contractURI = contractURI_;
        _allowedSeaDrop[seaDrop] = true;
        _enumeratedAllowedSeaDrop.push(seaDrop);
        emit SeaDropTokenDeployed();
    }

    // ---------------------------------------------------------------------
    // Minting
    // ---------------------------------------------------------------------

    /// @notice Called by SeaDrop once it has checked stage, price, proof and wallet limit (the sale on OpenSea).
    function mintSeaDrop(address minter, uint256 quantity) external {
        if (!_allowedSeaDrop[msg.sender]) revert OnlyAllowedSeaDrop();
        if (mintPaused) revert MintIsPaused();
        if (publicMinted + quantity > PUBLIC_CAP) revert ExceedsPublicAllocation();
        publicMinted += quantity;
        seaDropMinted[minter] += quantity;
        _mintBatch(minter, quantity);
    }

    /// @notice Team allocation, hard capped at 111 in bytecode. Same account + seed as every Face.
    function teamMint(address to, uint256 quantity) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 firstId) {
        if (teamMinted + quantity > TEAM_CAP) revert ExceedsTeamAllocation();
        teamMinted += quantity;
        firstId = _mintBatch(to, quantity);
        emit TeamMint(to, firstId, quantity);
    }

    /// @dev Mints sequential ids, then activates each Face (account + base seed) in the same transaction.
    /// Plain `_mint`: no receiver callback runs in the middle of a mint.
    function _mintBatch(address to, uint256 quantity) private returns (uint256 firstId) {
        if (quantity == 0) revert ZeroQuantity();
        if (mintClosed) revert MintIsClosed();
        // the art must be committed before the first Face exists, or it could never be sealed
        if (provenanceHash == bytes32(0)) revert ProvenanceNotSet();
        address s = seeder;
        if (s == address(0)) revert SeederNotSet(); // a Face is never born without its account
        firstId = totalSupply + 1;
        totalSupply += quantity;
        // MAX_SUPPLY is implied: PUBLIC_CAP + TEAM_CAP == MAX_SUPPLY
        for (uint256 i; i < quantity; ++i) {
            _mint(to, firstId + i);
        }
        for (uint256 i; i < quantity; ++i) {
            INeonSeeder(s).activate(firstId + i);
        }
    }

    /// @notice Wire the seeder. Once, before the first mint.
    function setSeeder(address newSeeder) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (seeder != address(0)) revert SeederAlreadySet();
        if (INeonSeeder(newSeeder).faces() != address(this)) revert SeederMismatch();
        seeder = newSeeder;
        emit SeederSet(newSeeder);
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
    // Provenance + reveal (commit before mint, keyed permutation after)
    // ---------------------------------------------------------------------

    /// @notice Commit the provenance hash of the full art set. Only once and only before mint.
    function setProvenanceHash(bytes32 hash) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (provenanceHash != bytes32(0)) revert ProvenanceAlreadySet();
        if (totalSupply != 0) revert MintAlreadyStarted();
        provenanceHash = hash;
        emit ProvenanceSet(hash);
    }

    /// @notice Step 1 of the reveal: pick a future L2 block whose hash will be the seed.
    /// Closes minting forever (art and Stare tiers become knowable at reveal).
    /// Can be called again only after the previous target block fell out of the 256-block window;
    /// every request is an event, so re-requests are publicly visible.
    function requestReveal() external onlyRole(METADATA_ROLE) {
        if (revealSeed != 0) revert RevealAlreadyDone();
        uint256 previous = revealBlock;
        if (previous != 0 && (ChainEntropy.blockNumber() <= previous || ChainEntropy.blockHash(previous) != bytes32(0))) {
            revert RevealStillOpen(); // target not mined yet, or its hash is still usable: call reveal()
        }
        if (!mintClosed) {
            mintClosed = true;
            emit MintClosed(totalSupply);
        }
        revealBlock = ChainEntropy.blockNumber() + REVEAL_DELAY_BLOCKS;
        ++revealRequests;
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
    // Royalties (ERC-2981), capped at 5%. Optional on marketplaces: transfers are never restricted.
    // ---------------------------------------------------------------------
    function setRoyaltyInfo(SeaDropRoyaltyInfo calldata info) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (info.royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh();
        _setDefaultRoyalty(info.royaltyAddress, info.royaltyBps);
    }

    function royaltyAddress() external view returns (address receiver) {
        (receiver,) = royaltyInfo(0, BPS);
    }

    function royaltyBasisPoints() external view returns (uint256 bps) {
        (, bps) = royaltyInfo(0, BPS);
    }

    // ---------------------------------------------------------------------
    // SeaDrop (OpenSea drop) configuration
    // ---------------------------------------------------------------------

    /// @notice The collection owner OpenSea sees: the sale manager while one is set, else the admin.
    function owner() public view override returns (address) {
        address m = saleManager;
        return m != address(0) ? m : defaultAdmin();
    }

    /// @notice Set (or clear with 0) the wallet that runs the drop in OpenSea Studio.
    function setSaleManager(address manager) external onlyRole(DEFAULT_ADMIN_ROLE) {
        saleManager = manager;
        emit SaleManagerSet(manager);
    }

    /// @notice Which SeaDrop contracts may mint. Admin only: an allowed SeaDrop can mint Faces.
    function updateAllowedSeaDrop(address[] calldata allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        for (uint256 i; i < _enumeratedAllowedSeaDrop.length; ++i) {
            _allowedSeaDrop[_enumeratedAllowedSeaDrop[i]] = false;
        }
        for (uint256 i; i < allowed.length; ++i) {
            _allowedSeaDrop[allowed[i]] = true;
        }
        _enumeratedAllowedSeaDrop = allowed;
        emit AllowedSeaDropUpdated(allowed);
    }

    /// @notice What SeaDrop may still sell against: the public allocation plus team Faces already minted
    /// (the unminted team reserve is not for sale). Equals the final supply once minting is closed.
    function maxSupply() public view returns (uint256) {
        return mintClosed ? totalSupply : PUBLIC_CAP + teamMinted;
    }

    /// @notice The supply is fixed in bytecode.
    function setMaxSupply(uint256) external pure {
        revert SupplyIsFixed();
    }

    function getMintStats(address minter)
        external
        view
        returns (uint256 minterNumMinted, uint256 currentTotalSupply, uint256 maxSupply_)
    {
        return (seaDropMinted[minter], totalSupply, maxSupply());
    }

    modifier onlySale() {
        if (msg.sender != saleManager && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert OnlySaleManager();
        _;
    }

    function _checkFee(uint256 feeBps, bool restricted) private pure {
        if (feeBps > MAX_FEE_BPS || !restricted) revert FeeNotAllowed();
    }

    /// @dev an empty stage (no per-wallet allowance) removes the stage and is always allowed
    function _checkGated(TokenGatedDropStage calldata stage) private pure {
        if (stage.maxTotalMintableByWallet != 0) _checkFee(stage.feeBps, stage.restrictFeeRecipients);
    }

    function _seaDrop(address impl) private view returns (ISeaDrop) {
        if (!_allowedSeaDrop[impl]) revert OnlyAllowedSeaDrop();
        return ISeaDrop(impl);
    }

    function updatePublicDrop(address impl, PublicDrop calldata drop) external onlySale {
        _checkFee(drop.feeBps, drop.restrictFeeRecipients);
        _seaDrop(impl).updatePublicDrop(drop);
    }

    function updateAllowList(address impl, AllowListData calldata data) external onlySale {
        _seaDrop(impl).updateAllowList(data);
    }

    function updateTokenGatedDrop(address impl, address nftToken, TokenGatedDropStage calldata stage)
        external
        onlySale
    {
        _checkGated(stage);
        _seaDrop(impl).updateTokenGatedDrop(nftToken, stage);
    }

    function updateDropURI(address impl, string calldata dropURI) external onlySale {
        _seaDrop(impl).updateDropURI(dropURI);
    }

    /// @notice Proceeds can only go to the immutable split: any other address reverts.
    function updateCreatorPayoutAddress(address impl, address payoutAddress) external onlySale {
        if (payoutAddress != payout) revert PayoutIsFixed();
        _seaDrop(impl).updateCreatorPayoutAddress(payoutAddress);
    }

    function updateAllowedFeeRecipient(address impl, address feeRecipient, bool allowed) external onlySale {
        _seaDrop(impl).updateAllowedFeeRecipient(feeRecipient, allowed);
    }

    function updateSignedMintValidationParams(address impl, address signer, SignedMintValidationParams memory params)
        external
        onlySale
    {
        if (params.maxFeeBps > MAX_FEE_BPS) revert FeeNotAllowed(); // signed mints always restrict recipients
        _seaDrop(impl).updateSignedMintValidationParams(signer, params);
    }

    function updatePayer(address impl, address payer, bool allowed) external onlySale {
        _seaDrop(impl).updatePayer(payer, allowed);
    }

    /// @notice OpenSea Studio's single configuration call. Supply, base URI, contract URI and provenance
    /// are ignored: they are fixed or governed on-chain here. Everything else is forwarded to SeaDrop.
    function multiConfigure(MultiConfigureStruct calldata c) external onlySale {
        ISeaDrop sd = _seaDrop(c.seaDropImpl);
        if (c.publicDrop.startTime != 0 || c.publicDrop.endTime != 0) {
            _checkFee(c.publicDrop.feeBps, c.publicDrop.restrictFeeRecipients);
            sd.updatePublicDrop(c.publicDrop);
        }
        if (bytes(c.dropURI).length != 0) sd.updateDropURI(c.dropURI);
        if (c.allowListData.merkleRoot != bytes32(0)) sd.updateAllowList(c.allowListData);
        if (c.creatorPayoutAddress != address(0)) {
            if (c.creatorPayoutAddress != payout) revert PayoutIsFixed();
            sd.updateCreatorPayoutAddress(c.creatorPayoutAddress);
        }
        for (uint256 i; i < c.allowedFeeRecipients.length; ++i) {
            sd.updateAllowedFeeRecipient(c.allowedFeeRecipients[i], true);
        }
        for (uint256 i; i < c.disallowedFeeRecipients.length; ++i) {
            sd.updateAllowedFeeRecipient(c.disallowedFeeRecipients[i], false);
        }
        for (uint256 i; i < c.allowedPayers.length; ++i) {
            sd.updatePayer(c.allowedPayers[i], true);
        }
        for (uint256 i; i < c.disallowedPayers.length; ++i) {
            sd.updatePayer(c.disallowedPayers[i], false);
        }
        if (c.tokenGatedDropStages.length != c.tokenGatedAllowedNftTokens.length) revert InvalidConfig();
        for (uint256 i; i < c.tokenGatedDropStages.length; ++i) {
            _checkGated(c.tokenGatedDropStages[i]);
            sd.updateTokenGatedDrop(c.tokenGatedAllowedNftTokens[i], c.tokenGatedDropStages[i]);
        }
        TokenGatedDropStage memory noStage;
        for (uint256 i; i < c.disallowedTokenGatedAllowedNftTokens.length; ++i) {
            sd.updateTokenGatedDrop(c.disallowedTokenGatedAllowedNftTokens[i], noStage);
        }
        if (c.signedMintValidationParams.length != c.signers.length) revert InvalidConfig();
        for (uint256 i; i < c.signers.length; ++i) {
            if (c.signedMintValidationParams[i].maxFeeBps > MAX_FEE_BPS) revert FeeNotAllowed();
            sd.updateSignedMintValidationParams(c.signers[i], c.signedMintValidationParams[i]);
        }
        SignedMintValidationParams memory noParams;
        for (uint256 i; i < c.disallowedSigners.length; ++i) {
            sd.updateSignedMintValidationParams(c.disallowedSigners[i], noParams);
        }
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
            || interfaceId == type(INonFungibleSeaDropToken).interfaceId
            || interfaceId == type(ISeaDropTokenContractMetadata).interfaceId || ERC721.supportsInterface(interfaceId)
            || ERC2981.supportsInterface(interfaceId) || AccessControlDefaultAdminRules.supportsInterface(interfaceId);
    }
}

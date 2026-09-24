// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {NeonFaces} from "./NeonFaces.sol";
import {NeonSeeder} from "./NeonSeeder.sol";

/// @title NeonMinter — sale logic for NEONFACES
/// @notice Phases: Closed -> Builders (allowlist, free) -> Allowlist (discounted) -> Public -> Finished.
/// Every Face minted here gets its ERC-6551 account and its seed in the same transaction.
///
/// Mint proceeds are split on-chain, with shares fixed at deployment (immutable):
///   40% Seed vault   — buys Stock Tokens / USDG that refill the NeonSeeder pool
///   25% Treasury     — multisig: art, site, market making
///   20% Team         — an OpenZeppelin VestingWallet (linear, 6 months)
///   15% Growth       — collabs + growth
/// Anyone can push the split with `release()`; nobody can redirect it.
contract NeonMinter is AccessControlDefaultAdminRules, ReentrancyGuard {
    enum Phase {
        Closed,
        Builders, // allowlist 1: early chain builders, usually free
        Allowlist, // allowlist 2: community, discounted
        Public,
        Finished // terminal, cannot be reopened
    }

    struct PhaseConfig {
        uint128 price; // wei per Face
        uint32 maxPerWallet; // public cap (allowlist phases use the allowance in the Merkle leaf)
        uint32 supplyCap; // max Faces sold in this phase (0 = no phase cap)
        uint32 minted; // Faces sold in this phase
        bytes32 merkleRoot; // leaf = keccak256(bytes.concat(keccak256(abi.encode(account, allowance))))
    }

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    uint256 public constant MAX_PER_TX = 10;
    uint256 public constant BPS = 10_000;

    NeonFaces public immutable faces;
    NeonSeeder public immutable seeder;

    // ---- immutable split ----
    address payable public immutable seedVault;
    address payable public immutable treasury;
    address payable public immutable team;
    address payable public immutable growth;
    uint256 public constant SEED_BPS = 4_000;
    uint256 public constant TREASURY_BPS = 2_500;
    uint256 public constant TEAM_BPS = 2_000;
    uint256 public constant GROWTH_BPS = 1_500;

    Phase public phase;
    mapping(Phase => PhaseConfig) public phaseConfig;
    mapping(Phase => mapping(address => uint256)) public mintedBy;

    uint256 public totalReleased;
    mapping(address => uint256) public released;

    event PhaseChanged(Phase phase);
    event PhaseConfigured(Phase indexed phase, uint128 price, uint32 maxPerWallet, uint32 supplyCap, bytes32 merkleRoot);
    event Minted(address indexed to, Phase indexed phase, uint256 firstId, uint256 quantity, uint256 paid);
    event Released(address indexed payee, uint256 amount);

    error SaleNotActive();
    error InvalidQuantity();
    error WrongPayment(uint256 expected);
    error NotAllowlisted();
    error WalletLimit();
    error PhaseSoldOut();
    error PhaseFinished();
    error InvalidPhase();
    error ZeroAddress();
    error DuplicatePayee();

    constructor(
        NeonFaces faces_,
        NeonSeeder seeder_,
        address admin,
        address payable seedVault_,
        address payable treasury_,
        address payable team_,
        address payable growth_
    ) AccessControlDefaultAdminRules(2 days, admin) {
        if (seedVault_ == address(0) || treasury_ == address(0) || team_ == address(0) || growth_ == address(0)) {
            revert ZeroAddress();
        }
        if (
            seedVault_ == treasury_ || seedVault_ == team_ || seedVault_ == growth_ || treasury_ == team_
                || treasury_ == growth_ || team_ == growth_
        ) revert DuplicatePayee();
        faces = faces_;
        seeder = seeder_;
        seedVault = seedVault_;
        treasury = treasury_;
        team = team_;
        growth = growth_;
        _grantRole(OPERATOR_ROLE, admin);
    }

    // ------------------------------------------------------------------
    // Mint
    // ------------------------------------------------------------------

    /// @param quantity number of Faces (1..10)
    /// @param allowance the allowance encoded in the caller's Merkle leaf (ignored in Public)
    /// @param proof Merkle proof for (msg.sender, allowance) (empty in Public)
    function mint(uint256 quantity, uint256 allowance, bytes32[] calldata proof)
        external
        payable
        nonReentrant
        returns (uint256 firstId)
    {
        Phase p = phase;
        if (p == Phase.Closed || p == Phase.Finished) revert SaleNotActive();
        if (quantity == 0 || quantity > MAX_PER_TX) revert InvalidQuantity();

        PhaseConfig storage cfg = phaseConfig[p];
        uint256 cost = uint256(cfg.price) * quantity;
        if (msg.value != cost) revert WrongPayment(cost);

        uint256 already = mintedBy[p][msg.sender];
        uint256 cap;
        if (p == Phase.Public) {
            cap = cfg.maxPerWallet;
        } else {
            bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, allowance))));
            if (!MerkleProof.verifyCalldata(proof, cfg.merkleRoot, leaf)) revert NotAllowlisted();
            cap = allowance;
        }
        if (already + quantity > cap) revert WalletLimit();
        if (cfg.supplyCap != 0 && cfg.minted + quantity > cfg.supplyCap) revert PhaseSoldOut();

        mintedBy[p][msg.sender] = already + quantity;
        cfg.minted += uint32(quantity);

        firstId = faces.mint(msg.sender, quantity);
        for (uint256 i; i < quantity; ++i) {
            seeder.activate(firstId + i);
        }
        emit Minted(msg.sender, p, firstId, quantity, msg.value);
    }

    // ------------------------------------------------------------------
    // Admin
    // ------------------------------------------------------------------
    function configurePhase(Phase p, uint128 price, uint32 maxPerWallet, uint32 supplyCap, bytes32 merkleRoot)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (p == Phase.Closed || p == Phase.Finished) revert InvalidPhase();
        PhaseConfig storage cfg = phaseConfig[p];
        cfg.price = price;
        cfg.maxPerWallet = maxPerWallet;
        cfg.supplyCap = supplyCap;
        cfg.merkleRoot = merkleRoot;
        emit PhaseConfigured(p, price, maxPerWallet, supplyCap, merkleRoot);
    }

    function setPhase(Phase p) external onlyRole(OPERATOR_ROLE) {
        if (phase == Phase.Finished) revert PhaseFinished();
        phase = p;
        emit PhaseChanged(p);
    }

    // ------------------------------------------------------------------
    // Proceeds split (pull-style accounting, push by anyone)
    // ------------------------------------------------------------------
    function payees() external view returns (address[4] memory accounts, uint256[4] memory shares) {
        accounts = [address(seedVault), address(treasury), address(team), address(growth)];
        shares = [SEED_BPS, TREASURY_BPS, TEAM_BPS, GROWTH_BPS];
    }

    function releasable(address payee) public view returns (uint256) {
        uint256 share = _shareOf(payee);
        if (share == 0) return 0;
        uint256 totalReceived = address(this).balance + totalReleased;
        return totalReceived * share / BPS - released[payee];
    }

    /// @notice Send `payee` its share of everything received so far.
    function release(address payable payee) public nonReentrant {
        uint256 amount = releasable(payee);
        if (amount == 0) return;
        released[payee] += amount;
        totalReleased += amount;
        emit Released(payee, amount);
        Address.sendValue(payee, amount);
    }

    /// @notice Push all four shares at once.
    function releaseAll() external {
        release(seedVault);
        release(treasury);
        release(team);
        release(growth);
    }

    function _shareOf(address payee) internal view returns (uint256) {
        if (payee == seedVault) return SEED_BPS;
        if (payee == treasury) return TREASURY_BPS;
        if (payee == team) return TEAM_BPS;
        if (payee == growth) return GROWTH_BPS;
        return 0;
    }

    // ------------------------------------------------------------------
    // Views for the mint page
    // ------------------------------------------------------------------
    function status()
        external
        view
        returns (Phase currentPhase, PhaseConfig memory cfg, uint256 totalMinted, uint256 publicRemaining)
    {
        currentPhase = phase;
        cfg = phaseConfig[phase];
        totalMinted = faces.totalSupply();
        publicRemaining = faces.PUBLIC_CAP() - faces.publicMinted();
    }
}

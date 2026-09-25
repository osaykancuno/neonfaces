// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC6551Registry} from "./interfaces/IERC6551Registry.sol";
import {ChainEntropy} from "./lib/ChainEntropy.sol";
import {NeonFaces} from "./NeonFaces.sol";

/// @title NeonSeeder — gives every Face its account and its first stare at the market
/// @notice Two moments, both recorded on-chain per tokenId:
///  1. **Mint** (`activate`): the ERC-6551 account is created through the canonical registry and funded
///     with a *base* basket (all base baskets have the same target value). A Face is never born empty.
///  2. **Reveal** (`upgrade`): the reveal seed maps every token to one art piece through a keyed
///     permutation of [0, 5555). The art decides the Stare tier (4444 Glance / 833 Watch / 278 Heavy
///     Stare, exact by construction). Watch and Heavy Stare Faces then receive a tier top-up basket.
///
/// @dev Why the tier is NOT drawn at mint: anything decided inside the mint transaction can be
/// re-rolled by a contract that reverts on a bad outcome. The tier is unknowable until the reveal seed
/// exists, and minting is closed for good before the reveal is requested (NeonFaces).
///
/// Seeding never blocks a mint: base funding runs in a try/catch self-call. If the pool is short (or
/// a token refuses the transfer) the seed stays *pending* and anyone can call `fund(tokenId)` later.
///
/// Stock Tokens give economic exposure only (no legal ownership of the underlying share) and are not
/// available to US persons. The holder can empty the Face account at any time.
contract NeonSeeder is AccessControlDefaultAdminRules, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------
    uint8 public constant TIER_GLANCE = 1;
    uint8 public constant TIER_WATCH = 2;
    uint8 public constant TIER_HEAVY = 3;
    /// @dev `_tierBaskets[BASE]` = baskets delivered at mint; `[WATCH]` / `[HEAVY]` = top-ups at reveal.
    uint8 public constant BASE = TIER_GLANCE;

    struct Leg {
        address token;
        uint256 amount;
    }

    struct Seed {
        bool activated;
        bool funded; // base basket delivered
        bool upgraded; // tier top-up delivered (Watch / Heavy Stare only)
        uint32 basketId; // base basket id (0 until funded)
        uint32 upgradeBasketId; // top-up basket id (0 until upgraded)
        uint32 variant; // picks the base basket among equivalent ones
    }

    struct SeedView {
        address account;
        uint8 tier; // 0 until revealed
        uint32 basketId;
        uint32 upgradeBasketId;
        bool activated;
        bool funded;
        bool upgraded;
        Leg[] legs; // base basket
        Leg[] upgradeLegs; // tier top-up
    }

    // ------------------------------------------------------------------
    // Immutable wiring
    // ------------------------------------------------------------------
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant ACCOUNT_SALT = bytes32(0);

    NeonFaces public immutable faces;
    IERC6551Registry public immutable registry;
    address public immutable accountImplementation;

    // art ids [0,4444) Glance, [4444,5277) Watch, [5277,5555) Heavy Stare
    uint256 public constant ART_COUNT = 5555;
    uint256 public constant GLANCE_SIZE = 4444;
    uint256 public constant WATCH_SIZE = 833;
    uint256 public constant HEAVY_SIZE = 278;

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    mapping(uint256 tokenId => Seed) internal _seeds;
    uint256 public activatedCount;
    uint256 public fundedCount;
    uint256 public upgradedCount;
    uint256 private _nonce;

    mapping(uint256 basketId => Leg[]) internal _baskets;
    uint256 public basketCount; // basket ids are 1..basketCount
    mapping(uint8 tier => uint32[]) internal _tierBaskets;
    bool public configLocked;

    // ------------------------------------------------------------------
    // Events / errors
    // ------------------------------------------------------------------
    event FaceActivated(uint256 indexed tokenId, address indexed account);
    event FaceSeeded(uint256 indexed tokenId, address indexed account, uint32 indexed basketId);
    event FaceUpgraded(uint256 indexed tokenId, address indexed account, uint8 tier, uint32 indexed basketId);
    event SeedPending(uint256 indexed tokenId, bytes reason);
    event BasketSet(uint32 indexed basketId, Leg[] legs);
    event TierBasketsSet(uint8 indexed tier, uint32[] basketIds);
    event ConfigLocked();
    event PoolWithdrawn(address indexed token, address indexed to, uint256 amount);

    error InvalidTier();
    error InvalidBasket();
    error ConfigIsLocked();
    error OnlySelf();
    error NotActivated();
    error AlreadyFunded();
    error NotUpgradeable(uint256 tokenId);
    error NoBasketForTier();
    error InsufficientPool(address token, uint256 needed, uint256 available);

    constructor(NeonFaces faces_, IERC6551Registry registry_, address accountImplementation_, address admin)
        AccessControlDefaultAdminRules(2 days, admin)
    {
        faces = faces_;
        registry = registry_;
        accountImplementation = accountImplementation_;
    }

    // ------------------------------------------------------------------
    // Mint time: account + base seed (permissionless, idempotent)
    // ------------------------------------------------------------------

    /// @notice Create the Face account and try to deliver its base seed.
    /// Called by NeonFaces in every mint transaction; anyone can call it again (idempotent, retries).
    function activate(uint256 tokenId) public nonReentrant returns (address account) {
        faces.ownerOf(tokenId); // reverts for ids that do not exist
        account = registry.createAccount(accountImplementation, ACCOUNT_SALT, block.chainid, address(faces), tokenId);

        Seed storage s = _seeds[tokenId];
        if (!s.activated) {
            s.activated = true;
            // base baskets are equivalent in value, so this draw is not worth gaming
            s.variant = uint32(uint256(keccak256(abi.encode(ChainEntropy.previousBlockHash(), tokenId, _nonce++))));
            unchecked {
                ++activatedCount;
            }
            emit FaceActivated(tokenId, account);
        }

        if (!s.funded) {
            try this.fundFromSelf(tokenId, account) {}
            catch (bytes memory reason) {
                emit SeedPending(tokenId, reason);
            }
        }
    }

    function activateBatch(uint256[] calldata tokenIds) external {
        for (uint256 i; i < tokenIds.length; ++i) {
            activate(tokenIds[i]);
        }
    }

    /// @notice Retry a pending base seed (e.g. after the pool was refilled). Reverts with the reason.
    function fund(uint256 tokenId) external nonReentrant {
        if (!_seeds[tokenId].activated) revert NotActivated();
        if (_seeds[tokenId].funded) revert AlreadyFunded();
        _fund(tokenId, accountOf(tokenId));
    }

    /// @dev External only so `activate` can wrap it in try/catch. Callable by this contract only.
    function fundFromSelf(uint256 tokenId, address account) external {
        if (msg.sender != address(this)) revert OnlySelf();
        _fund(tokenId, account);
    }

    function _fund(uint256 tokenId, address account) internal {
        Seed storage s = _seeds[tokenId];
        uint32[] storage options = _tierBaskets[BASE];
        if (options.length == 0) revert NoBasketForTier();
        uint32 basketId = options[s.variant % options.length];
        s.basketId = basketId;
        s.funded = true;
        unchecked {
            ++fundedCount;
        }
        _deliver(basketId, account);
        emit FaceSeeded(tokenId, account, basketId);
    }

    // ------------------------------------------------------------------
    // Reveal time: tier top-ups (permissionless)
    // ------------------------------------------------------------------

    /// @notice Deliver the Watch / Heavy Stare top-up of a revealed Face.
    function upgrade(uint256 tokenId) public nonReentrant {
        if (!_upgrade(tokenId)) revert NotUpgradeable(tokenId);
    }

    /// @notice Upgrade many Faces; ids that are not eligible (Glance, already upgraded, unrevealed) are skipped.
    function upgradeBatch(uint256[] calldata tokenIds) external nonReentrant returns (uint256 done) {
        for (uint256 i; i < tokenIds.length; ++i) {
            if (_upgrade(tokenIds[i])) ++done;
        }
    }

    function _upgrade(uint256 tokenId) internal returns (bool) {
        Seed storage s = _seeds[tokenId];
        uint8 tier = tierOf(tokenId);
        if (tier < TIER_WATCH || s.upgraded) return false;
        uint32[] storage options = _tierBaskets[tier];
        if (options.length == 0) revert NoBasketForTier();
        uint32 basketId = options[uint256(keccak256(abi.encode(faces.revealSeed(), tokenId))) % options.length];
        address account = accountOf(tokenId);
        s.upgraded = true;
        s.upgradeBasketId = basketId;
        unchecked {
            ++upgradedCount;
        }
        _deliver(basketId, account);
        emit FaceUpgraded(tokenId, account, tier, basketId);
        return true;
    }

    function _deliver(uint32 basketId, address account) internal {
        Leg[] storage legs = _baskets[basketId];
        for (uint256 i; i < legs.length; ++i) {
            uint256 bal = IERC20(legs[i].token).balanceOf(address(this));
            if (bal < legs[i].amount) revert InsufficientPool(legs[i].token, legs[i].amount, bal);
        }
        for (uint256 i; i < legs.length; ++i) {
            IERC20(legs[i].token).safeTransfer(account, legs[i].amount);
        }
    }

    // ------------------------------------------------------------------
    // Reveal mapping: keyed permutation of [0, 5555)
    // ------------------------------------------------------------------

    /// @notice Art piece of a Face: `(a * (tokenId - 1) + b) mod 5555`, with `a` coprime to 5555
    /// (= 5 * 11 * 101) and `(a, b)` derived from the reveal seed — a bijection, verifiable by anyone.
    /// Returns type(uint256).max while unrevealed or for nonexistent tokens.
    function artIdOf(uint256 tokenId) public view returns (uint256) {
        uint256 seed = faces.revealSeed();
        if (seed == 0 || tokenId == 0 || tokenId > ART_COUNT || !faces.exists(tokenId)) return type(uint256).max;
        (uint256 a, uint256 b) = permutationKey(seed);
        return (a * (tokenId - 1) + b) % ART_COUNT;
    }

    function permutationKey(uint256 seed) public pure returns (uint256 a, uint256 b) {
        a = 1 + (seed % (ART_COUNT - 1));
        while (a % 5 == 0 || a % 11 == 0 || a % 101 == 0) {
            a = a + 1 == ART_COUNT ? 1 : a + 1;
        }
        b = (seed >> 128) % ART_COUNT;
    }

    /// @notice Stare tier of a Face (0 until revealed).
    function tierOf(uint256 tokenId) public view returns (uint8) {
        uint256 art = artIdOf(tokenId);
        if (art == type(uint256).max) return 0;
        if (art < GLANCE_SIZE) return TIER_GLANCE;
        if (art < GLANCE_SIZE + WATCH_SIZE) return TIER_WATCH;
        return TIER_HEAVY;
    }

    // ------------------------------------------------------------------
    // Configuration (until locked)
    // ------------------------------------------------------------------

    /// @notice Create or overwrite basket `basketId` (1..basketCount+1).
    function setBasket(uint32 basketId, Leg[] calldata legs) external onlyRole(CONFIG_ROLE) {
        if (configLocked) revert ConfigIsLocked();
        if (basketId == 0 || basketId > basketCount + 1 || legs.length == 0 || legs.length > 8) revert InvalidBasket();
        if (basketId == basketCount + 1) basketCount = basketId;
        delete _baskets[basketId];
        for (uint256 i; i < legs.length; ++i) {
            if (legs[i].token == address(0) || legs[i].amount == 0) revert InvalidBasket();
            _baskets[basketId].push(legs[i]);
        }
        emit BasketSet(basketId, legs);
    }

    /// @notice Tier 1 = base baskets (delivered at mint to every Face); tiers 2/3 = top-ups at reveal.
    function setTierBaskets(uint8 tier, uint32[] calldata basketIds) external onlyRole(CONFIG_ROLE) {
        if (configLocked) revert ConfigIsLocked();
        if (tier < TIER_GLANCE || tier > TIER_HEAVY) revert InvalidTier();
        for (uint256 i; i < basketIds.length; ++i) {
            if (basketIds[i] == 0 || basketIds[i] > basketCount) revert InvalidBasket();
        }
        _tierBaskets[tier] = basketIds;
        emit TierBasketsSet(tier, basketIds);
    }

    /// @notice Irreversibly freeze baskets and tier mapping.
    function lockConfig() external onlyRole(DEFAULT_ADMIN_ROLE) {
        configLocked = true;
        emit ConfigLocked();
    }

    /// @notice Withdraw surplus from the seed pool. Seeds already delivered are unaffected:
    /// their tokens live in the Face accounts, not here.
    function withdrawPool(address token, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(token).safeTransfer(to, amount);
        emit PoolWithdrawn(token, to, amount);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------
    function accountOf(uint256 tokenId) public view returns (address) {
        return registry.account(accountImplementation, ACCOUNT_SALT, block.chainid, address(faces), tokenId);
    }

    function seedOf(uint256 tokenId) external view returns (SeedView memory v) {
        Seed memory s = _seeds[tokenId];
        v.account = accountOf(tokenId);
        v.tier = tierOf(tokenId);
        v.basketId = s.basketId;
        v.upgradeBasketId = s.upgradeBasketId;
        v.activated = s.activated;
        v.funded = s.funded;
        v.upgraded = s.upgraded;
        if (s.basketId != 0) v.legs = _baskets[s.basketId];
        if (s.upgradeBasketId != 0) v.upgradeLegs = _baskets[s.upgradeBasketId];
    }

    function basket(uint32 basketId) external view returns (Leg[] memory) {
        return _baskets[basketId];
    }

    function tierBaskets(uint8 tier) external view returns (uint32[] memory) {
        return _tierBaskets[tier];
    }

    /// @notice How many more deliveries of basket `basketId` the pool can cover right now.
    function coverage(uint32 basketId) external view returns (uint256 n) {
        Leg[] storage legs = _baskets[basketId];
        if (legs.length == 0) return 0;
        n = type(uint256).max;
        for (uint256 i; i < legs.length; ++i) {
            uint256 k = IERC20(legs[i].token).balanceOf(address(this)) / legs[i].amount;
            if (k < n) n = k;
        }
    }
}

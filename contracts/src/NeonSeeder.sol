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
/// @notice For each Face:
///  1. creates its ERC-6551 account through the canonical registry (idempotent),
///  2. draws its Stare tier from an exact urn (4444 Glance / 833 Watch / 278 Heavy Stare),
///  3. funds the account with a basket of Stock Tokens / USDG from a pre-loaded treasury pool.
/// Everything is recorded on-chain per tokenId, so marketplaces and UIs can read it.
///
/// @dev Seeding can never block a mint: funding runs in a try/catch self-call. If the pool is short
/// (or a token refuses the transfer) the seed stays *pending* and anyone can call `fund(tokenId)`
/// once the pool is refilled. Activation is permissionless and idempotent.
///
/// Stock Tokens give economic exposure only (no legal ownership of the underlying share) and are
/// not available to US persons. The holder can empty the Face account at any time.
contract NeonSeeder is AccessControlDefaultAdminRules, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------
    // Types
    // ------------------------------------------------------------------
    uint8 public constant TIER_GLANCE = 1;
    uint8 public constant TIER_WATCH = 2;
    uint8 public constant TIER_HEAVY = 3;

    struct Leg {
        address token;
        uint256 amount;
    }

    struct Seed {
        uint8 tier; // 0 = not activated yet
        uint16 tierIndex; // position inside the tier (0-based), used by the reveal mapping
        uint32 basketId; // 0 until funded
        uint32 variant; // random draw used to pick the basket inside the tier
        bool funded;
    }

    struct SeedView {
        address account;
        uint8 tier;
        uint16 tierIndex;
        uint32 basketId;
        bool activated;
        bool funded;
        Leg[] legs;
    }

    // ------------------------------------------------------------------
    // Immutable wiring
    // ------------------------------------------------------------------
    bytes32 public constant CONFIG_ROLE = keccak256("CONFIG_ROLE");
    bytes32 public constant ACCOUNT_SALT = bytes32(0);

    NeonFaces public immutable faces;
    IERC6551Registry public immutable registry;
    address public immutable accountImplementation;

    // tier sizes are fixed and match the art: art ids [0,4444) Glance, [4444,5277) Watch, [5277,5555) Heavy
    uint256 public constant GLANCE_SIZE = 4444;
    uint256 public constant WATCH_SIZE = 833;
    uint256 public constant HEAVY_SIZE = 278;

    // ------------------------------------------------------------------
    // Storage
    // ------------------------------------------------------------------
    mapping(uint256 tokenId => Seed) internal _seeds;
    uint256[4] public tierAssigned; // index by tier id
    uint256 public activatedCount;
    uint256 public fundedCount;
    uint256 private _nonce;

    mapping(uint256 basketId => Leg[]) internal _baskets;
    uint256 public basketCount; // basket ids are 1..basketCount
    mapping(uint8 tier => uint32[]) internal _tierBaskets;
    bool public configLocked;

    // ------------------------------------------------------------------
    // Events / errors
    // ------------------------------------------------------------------
    event FaceActivated(uint256 indexed tokenId, address indexed account, uint8 tier, uint16 tierIndex);
    event FaceSeeded(uint256 indexed tokenId, address indexed account, uint32 indexed basketId);
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
    // Activation (permissionless, idempotent)
    // ------------------------------------------------------------------

    /// @notice Create the Face account, assign the Stare tier (first time) and try to fund the seed.
    /// Called by the minter in the mint transaction; anyone can call it for team mints or retries.
    function activate(uint256 tokenId) public nonReentrant returns (address account) {
        faces.ownerOf(tokenId); // reverts for ids that do not exist
        account = registry.createAccount(accountImplementation, ACCOUNT_SALT, block.chainid, address(faces), tokenId);

        Seed storage s = _seeds[tokenId];
        if (s.tier == 0) {
            (uint8 tier, uint16 idx, uint32 variant) = _drawTier(tokenId);
            s.tier = tier;
            s.tierIndex = idx;
            s.variant = variant;
            unchecked {
                ++activatedCount;
            }
            emit FaceActivated(tokenId, account, tier, idx);
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

    /// @notice Retry funding a pending seed (e.g. after the pool was refilled). Reverts with the reason.
    function fund(uint256 tokenId) external nonReentrant {
        if (_seeds[tokenId].tier == 0) revert NotActivated();
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
        uint32[] storage options = _tierBaskets[s.tier];
        if (options.length == 0) revert NoBasketForTier();
        uint32 basketId = options[s.variant % options.length];
        Leg[] storage legs = _baskets[basketId];

        for (uint256 i; i < legs.length; ++i) {
            uint256 bal = IERC20(legs[i].token).balanceOf(address(this));
            if (bal < legs[i].amount) revert InsufficientPool(legs[i].token, legs[i].amount, bal);
        }
        s.basketId = basketId;
        s.funded = true;
        unchecked {
            ++fundedCount;
        }
        for (uint256 i; i < legs.length; ++i) {
            IERC20(legs[i].token).safeTransfer(account, legs[i].amount);
        }
        emit FaceSeeded(tokenId, account, basketId);
    }

    /// @dev Exact urn: probability of each tier = remaining slots of that tier / remaining slots.
    /// Over the full supply this yields exactly 4444 / 833 / 278.
    function _drawTier(uint256 tokenId) internal returns (uint8 tier, uint16 idx, uint32 variant) {
        uint256 rGlance = GLANCE_SIZE - tierAssigned[1];
        uint256 rWatch = WATCH_SIZE - tierAssigned[2];
        uint256 rHeavy = HEAVY_SIZE - tierAssigned[3];
        uint256 remaining = rGlance + rWatch + rHeavy; // never 0: sum of sizes == MAX_SUPPLY

        uint256 rand = uint256(
            keccak256(
                abi.encode(ChainEntropy.previousBlockHash(), block.timestamp, tokenId, tx.origin, _nonce++, address(this))
            )
        );
        uint256 r = rand % remaining;
        if (r < rGlance) tier = TIER_GLANCE;
        else if (r < rGlance + rWatch) tier = TIER_WATCH;
        else tier = TIER_HEAVY;

        idx = uint16(tierAssigned[tier]++);
        variant = uint32(rand >> 128);
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

    /// @notice Baskets a tier can draw from (uniformly, by the Face's random variant).
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

    /// @notice Withdraw surplus from the seed pool. Already-seeded Faces are unaffected:
    /// their tokens live in their own accounts, not here.
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
        v.tier = s.tier;
        v.tierIndex = s.tierIndex;
        v.basketId = s.basketId;
        v.activated = s.tier != 0;
        v.funded = s.funded;
        if (s.basketId != 0) v.legs = _baskets[s.basketId];
    }

    function basket(uint32 basketId) external view returns (Leg[] memory) {
        return _baskets[basketId];
    }

    function tierBaskets(uint8 tier) external view returns (uint32[] memory) {
        return _tierBaskets[tier];
    }

    /// @notice How many more Faces of `tier` the pool can fund with basket `basketId` right now.
    function coverage(uint32 basketId) external view returns (uint256 faces_) {
        Leg[] storage legs = _baskets[basketId];
        if (legs.length == 0) return 0;
        faces_ = type(uint256).max;
        for (uint256 i; i < legs.length; ++i) {
            uint256 n = IERC20(legs[i].token).balanceOf(address(this)) / legs[i].amount;
            if (n < faces_) faces_ = n;
        }
    }

    /// @notice Art piece of a revealed Face: (tier, tierIndex) mapped with a per-tier random offset.
    /// artId ranges: Glance [0,4444), Watch [4444,5277), Heavy Stare [5277,5555).
    /// Returns type(uint256).max while unrevealed or not activated.
    function artIdOf(uint256 tokenId) external view returns (uint256) {
        uint256 seed = faces.revealSeed();
        Seed memory s = _seeds[tokenId];
        if (seed == 0 || s.tier == 0) return type(uint256).max;
        (uint256 first, uint256 size) = _tierRange(s.tier);
        uint256 offset = uint256(keccak256(abi.encode(seed, s.tier))) % size;
        return first + (uint256(s.tierIndex) + offset) % size;
    }

    function _tierRange(uint8 tier) internal pure returns (uint256 first, uint256 size) {
        if (tier == TIER_GLANCE) return (0, GLANCE_SIZE);
        if (tier == TIER_WATCH) return (GLANCE_SIZE, WATCH_SIZE);
        return (GLANCE_SIZE + WATCH_SIZE, HEAVY_SIZE);
    }
}

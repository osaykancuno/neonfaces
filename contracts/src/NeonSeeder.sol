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
/// @notice Three moments, all recorded on-chain:
///  1. **Mint** (`activate`): the ERC-6551 account is created through the canonical registry and funded
///     with a *base* basket (all base baskets have the same target value).
///  2. **Reveal** (`upgrade`): the reveal seed maps every token to one art piece (see `artIdOf`). The art
///     decides the Stare tier (4444 Glance / 833 Watch / 278 Heavy Stare over the 5555 artworks).
///     Watch and Heavy Stare Faces then receive a tier top-up basket.
///  3. **Sets** (`claimSetBonus`): 2220 of the artworks are 555 sets of 4 pieces of one face. The reveal
///     only hands out whole sets, so every set that exists can be completed. A set is *assembled* when
///     one piece's account holds the other three; its first assembly earns a one-time bonus basket.
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

    /// @dev `_tierBaskets[SET_BONUS]` = one-time bonus baskets for the first assembly of a set.
    uint8 public constant SET_BONUS = 4;

    // Art ids: [0, 3335) single close-ups, then set k (1..555) = 3335 + 4(k-1) .. +3
    // (left eye, right eye, left mouth, right mouth). Tiers by range, singles and sets separately:
    // singles [0,2668) Glance, [2668,3169) Watch, [3169,3335) Heavy Stare; sets 1..444 Glance, 445..527
    // Watch, 528..555 Heavy Stare. Totals: 4444 / 833 / 278.
    uint256 public constant ART_COUNT = 5555;
    uint256 public constant SINGLES = 3335;
    uint256 public constant SETS = 555;
    uint256 public constant SINGLE_GLANCE = 2668;
    uint256 public constant SINGLE_WATCH = 501;
    uint256 public constant SET_GLANCE = 444;
    uint256 public constant SET_WATCH = 83;

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

    struct SetBonusPaid {
        uint32 anchorId; // the Face whose account received it (0 = not paid yet)
        uint32 basketId;
    }

    mapping(uint256 setId => SetBonusPaid) public setBonus;
    uint256 public setBonusCount;

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
    event SetBonusPaidTo(uint256 indexed setId, uint256 indexed anchorId, address indexed account, uint32 basketId);

    error InvalidTier();
    error InvalidBasket();
    error ConfigIsLocked();
    error OnlySelf();
    error NotActivated();
    error AlreadyFunded();
    error NotUpgradeable(uint256 tokenId);
    error NoBasketForTier();
    error InsufficientPool(address token, uint256 needed, uint256 available);
    error SetNotAssembled(uint256 anchorId);
    error SetBonusAlreadyPaid(uint256 setId);

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

    // ------------------------------------------------------------------
    // Sets: one-time bonus on the first assembly (permissionless)
    // ------------------------------------------------------------------

    /// @notice Deliver the one-time bonus basket of an assembled set into the anchor's account. Anyone can
    /// call it (the keeper does it for every assembled set); it pays once per set, ever, so taking a set
    /// apart and assembling it again earns nothing.
    function claimSetBonus(uint256 anchorId) external nonReentrant {
        if (!isAssembled(anchorId)) revert SetNotAssembled(anchorId);
        (uint256 setId,,) = setOf(anchorId);
        if (setBonus[setId].anchorId != 0) revert SetBonusAlreadyPaid(setId);
        uint32[] storage options = _tierBaskets[SET_BONUS];
        if (options.length == 0) revert NoBasketForTier();
        uint32 basketId = options[uint256(keccak256(abi.encode(faces.revealSeed(), setId, SET_BONUS))) % options.length];
        address account = accountOf(anchorId);
        setBonus[setId] = SetBonusPaid(uint32(anchorId), basketId);
        unchecked {
            ++setBonusCount;
        }
        _deliver(basketId, account);
        emit SetBonusPaidTo(setId, anchorId, account, basketId);
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
    // Reveal mapping
    // ------------------------------------------------------------------

    /// @notice Art piece of a Face (type(uint256).max while unrevealed or for nonexistent tokens).
    /// With n Faces minted, every token gets a slot `p = (a·(id−1) + b) mod n` (a bijection, `a` coprime
    /// to n). The first `4·setsIn(n)` slots are whole sets, four slots per set; the other slots are single
    /// close-ups. Which sets and which singles is a second keyed permutation of each range, so a partial
    /// sale keeps tiers proportional on average, and every set handed out has all four pieces minted.
    /// Everything derives from the reveal seed: anyone can recompute it.
    function artIdOf(uint256 tokenId) public view returns (uint256) {
        (uint256 seed, uint256 n, uint256 p,) = _slot(tokenId);
        if (seed == 0) return type(uint256).max;
        uint256 setSlots = 4 * setsIn(n);
        if (p < setSlots) return SINGLES + 4 * (_setAt(seed, p / 4) - 1) + p % 4;
        return _perm(p - setSlots, SINGLES, uint256(keccak256(abi.encode(seed, 2))));
    }

    /// @notice Sets handed out when n Faces were minted: all 555 on a sell-out, proportionally fewer otherwise.
    function setsIn(uint256 n) public pure returns (uint256) {
        return n * SETS / ART_COUNT;
    }

    /// @notice The set of a Face: `setId` 1..555 (0 for a single close-up), its piece (0 left eye, 1 right
    /// eye, 2 left mouth, 3 right mouth) and the token ids of all four pieces, in piece order.
    function setOf(uint256 tokenId) public view returns (uint256 setId, uint256 piece, uint256[4] memory members) {
        (uint256 seed, uint256 n, uint256 p, uint256 inv) = _slot(tokenId);
        if (seed == 0 || p >= 4 * setsIn(n)) return (0, 0, members);
        setId = _setAt(seed, p / 4);
        piece = p % 4;
        uint256 b = (seed >> 128) % n;
        for (uint256 q; q < 4; ++q) {
            members[q] = mulmod(inv, p - piece + q + n - b, n) + 1; // id − 1 = a⁻¹ · (slot − b) mod n
        }
    }

    /// @notice True when the other three pieces of this Face's set sit inside this Face's account.
    function isAssembled(uint256 anchorId) public view returns (bool) {
        (uint256 setId,, uint256[4] memory m) = setOf(anchorId);
        if (setId == 0) return false;
        address account = accountOf(anchorId);
        for (uint256 q; q < 4; ++q) {
            if (m[q] != anchorId && faces.ownerOf(m[q]) != account) return false;
        }
        return true;
    }

    /// @notice The slot key for n minted Faces: `a` is coprime to n and, for n ≥ 256, chosen so the four
    /// ids of a set are never within n/64 of each other: minting a run of consecutive ids can't yield a
    /// finished set. Returns `a⁻¹ mod n` too (to list a set's members).
    function revealKey(uint256 seed, uint256 n) public pure returns (uint256 a, uint256 b, uint256 inv) {
        b = (seed >> 128) % n;
        if (n < 2) return (1, b, 1);
        uint256 gap = n >= 256 ? n >> 6 : 0;
        a = seed % (n - 1);
        while (true) {
            a = a + 1; // 1 .. n-1, wrapping
            if (a == n) a = 1;
            inv = _inverse(a, n);
            if (inv != 0 && (gap == 0 || _apart(inv, n, gap))) return (a, b, inv);
        }
    }

    /// @dev (seed, n, slot, a⁻¹); seed 0 while unrevealed or for nonexistent tokens.
    function _slot(uint256 tokenId) internal view returns (uint256 seed, uint256 n, uint256 p, uint256 inv) {
        seed = faces.revealSeed();
        n = faces.totalSupply(); // ids 1..n, no burn, minting closed before the reveal seed exists
        if (seed == 0 || tokenId == 0 || tokenId > n) return (0, 0, 0, 0);
        uint256 a;
        uint256 b;
        (a, b, inv) = revealKey(seed, n);
        p = mulmod(a, tokenId - 1, n) + b;
        if (p >= n) p -= n;
    }

    /// @dev Set id (1..555) handed out in set slot k.
    function _setAt(uint256 seed, uint256 k) internal pure returns (uint256) {
        return _perm(k, SETS, uint256(keccak256(abi.encode(seed, 1)))) + 1;
    }

    /// @dev Keyed permutation of [0, m): (c·x + d) mod m with c coprime to m.
    function _perm(uint256 x, uint256 m, uint256 key) internal pure returns (uint256) {
        uint256 c = 1 + key % (m - 1);
        while (_inverse(c, m) == 0) {
            c = c + 1 == m ? 1 : c + 1;
        }
        return (c * x + (key >> 128) % m) % m;
    }

    /// @dev k·inv mod n stays more than `gap` away from 0 for k = 1, 2, 3.
    function _apart(uint256 inv, uint256 n, uint256 gap) internal pure returns (bool) {
        for (uint256 k = 1; k < 4; ++k) {
            uint256 r = (k * inv) % n;
            if (r <= gap || n - r <= gap) return false;
        }
        return true;
    }

    /// @dev Modular inverse of x mod n, 0 if none (gcd ≠ 1).
    function _inverse(uint256 x, uint256 n) internal pure returns (uint256) {
        int256 t;
        int256 t1 = 1;
        uint256 r = n;
        uint256 r1 = x % n;
        while (r1 != 0) {
            uint256 q = r / r1;
            (t, t1) = (t1, t - int256(q) * t1);
            (r, r1) = (r1, r - q * r1);
        }
        if (r != 1) return 0;
        return t < 0 ? uint256(t + int256(n)) : uint256(t);
    }

    /// @notice Stare tier of a Face (0 until revealed). The four pieces of a set share its tier.
    function tierOf(uint256 tokenId) public view returns (uint8) {
        uint256 art = artIdOf(tokenId);
        if (art == type(uint256).max) return 0;
        if (art < SINGLES) {
            if (art < SINGLE_GLANCE) return TIER_GLANCE;
            return art < SINGLE_GLANCE + SINGLE_WATCH ? TIER_WATCH : TIER_HEAVY;
        }
        uint256 set = (art - SINGLES) / 4;
        if (set < SET_GLANCE) return TIER_GLANCE;
        return set < SET_GLANCE + SET_WATCH ? TIER_WATCH : TIER_HEAVY;
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

    /// @notice Tier 1 = base baskets (delivered at mint to every Face); tiers 2/3 = top-ups at reveal;
    /// 4 (SET_BONUS) = one-time bonus for the first assembly of a set.
    function setTierBaskets(uint8 tier, uint32[] calldata basketIds) external onlyRole(CONFIG_ROLE) {
        if (configLocked) revert ConfigIsLocked();
        if (tier < TIER_GLANCE || tier > SET_BONUS) revert InvalidTier();
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
